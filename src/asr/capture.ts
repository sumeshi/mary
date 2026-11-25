const TARGET_SAMPLE_RATE = 16000;
const CHUNK_FRAMES = 4096;
const WORKLET_NAME = 'mary-capture';

export interface MicrophoneCaptureHandlers {
  onAudio(samples: Float32Array): void;
  onError(message: string): void;
}

/**
 * Captures microphone audio, downmixes it to mono, and delivers 16 kHz PCM.
 * The worklet buffers roughly 85 ms at 48 kHz so the main thread is not woken
 * for every 128-frame render quantum.
 */
export class MicrophoneCapture {
  private readonly handlers: MicrophoneCaptureHandlers;
  private mediaStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private running = false;
  private failed = false;
  private generation = 0;

  constructor(handlers: MicrophoneCaptureHandlers) {
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error('Microphone capture is already running.');

    const generation = ++this.generation;
    this.running = true;
    this.failed = false;

    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('Microphone capture is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!this.isCurrent(generation)) {
        for (const track of stream.getTracks()) track.stop();
        throw new DOMException('Microphone capture stopped.', 'AbortError');
      }

      this.mediaStream = stream;
      for (const track of stream.getAudioTracks()) {
        track.addEventListener('ended', this.handleTrackEnded);
      }

      const context = new AudioContext();
      this.context = context;
      context.onstatechange = this.handleContextStateChange;

      // A context created after the user gesture has expired starts suspended
      // and never pulls audio, so resume it before connecting the graph. Safari
      // also reports "interrupted" after the page is backgrounded.
      const state = context.state as string;
      if (state === 'suspended' || state === 'interrupted') {
        await context.resume();
      }
      this.assertCurrent(generation);

      const source = context.createMediaStreamSource(stream);
      this.source = source;

      const onChunk = (chunk: Float32Array): void => {
        if (!this.isCurrent(generation)) return;
        this.handlers.onAudio(resampleTo16k(chunk, context.sampleRate));
      };

      if (
        typeof AudioWorkletNode !== 'undefined' &&
        typeof context.audioWorklet?.addModule === 'function'
      ) {
        await this.setupWorklet(context, source, generation, onChunk);
      } else {
        this.setupScriptProcessor(context, source, generation, onChunk);
      }

      this.assertCurrent(generation);
    } catch (error) {
      await this.stop();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1;

    const context = this.context;
    const stream = this.mediaStream;
    const worklet = this.worklet;
    const processor = this.processor;
    const source = this.source;

    this.context = null;
    this.mediaStream = null;
    this.worklet = null;
    this.processor = null;
    this.source = null;

    if (worklet) {
      worklet.port.onmessage = null;
      worklet.onprocessorerror = null;
      worklet.disconnect();
    }
    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    source?.disconnect();

    if (context) context.onstatechange = null;

    if (stream) {
      for (const track of stream.getTracks()) {
        track.removeEventListener('ended', this.handleTrackEnded);
        track.stop();
      }
    }

    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        // The context may already have been closed by the browser.
      }
    }
  }

  private async setupWorklet(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    generation: number,
    onChunk: (chunk: Float32Array) => void,
  ): Promise<void> {
    const url = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: 'text/javascript' }),
    );

    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    this.assertCurrent(generation);

    const node = new AudioWorkletNode(context, WORKLET_NAME);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this.isCurrent(generation)) return;
      onChunk(event.data);
    };
    node.onprocessorerror = () => this.fail('Audio processing failed.');

    this.worklet = node;
    source.connect(node);
    // The graph must reach the destination for the worklet to be pulled.
    node.connect(context.destination);
  }

  private setupScriptProcessor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    generation: number,
    onChunk: (chunk: Float32Array) => void,
  ): void {
    if (typeof context.createScriptProcessor !== 'function') {
      throw new Error('Microphone capture is not supported in this browser.');
    }

    const processor = context.createScriptProcessor(CHUNK_FRAMES, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!this.isCurrent(generation)) return;
      // ScriptProcessorNode reuses its input buffer, so copy it.
      onChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    this.processor = processor;
    source.connect(processor);
    processor.connect(context.destination);
  }

  private fail(message: string): void {
    if (!this.running || this.failed) return;
    this.failed = true;
    void this.stop().then(
      () => this.handlers.onError(message),
      () => this.handlers.onError(message),
    );
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new DOMException('Microphone capture stopped.', 'AbortError');
    }
  }

  private readonly handleTrackEnded = (): void => {
    if (!this.running) return;
    this.fail('Microphone input ended.');
  };

  private readonly handleContextStateChange = (): void => {
    const context = this.context;
    if (!context || !this.running) return;

    const state = context.state as string;
    if (state === 'closed') {
      this.fail('Audio context closed unexpectedly.');
      return;
    }

    // Safari also reports "interrupted"; both states stop pulling audio.
    if (state === 'suspended' || state === 'interrupted') {
      void context
        .resume()
        .catch(() => this.fail('Audio context could not resume.'));
    }
  };
}

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;

  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = input[index] ?? 0;
    const next = input[index + 1] ?? current;
    output[i] = current + (next - current) * fraction;
  }

  return output;
}

const WORKLET_SOURCE = `
class MaryCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${CHUNK_FRAMES});
    this.frames = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || !channels[0]) return true;

    const frames = channels[0].length;
    let offset = 0;
    while (offset < frames) {
      const take = Math.min(frames - offset, this.buffer.length - this.frames);
      for (let i = 0; i < take; i += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels.length; channel += 1) {
          sum += channels[channel][offset + i] ?? 0;
        }
        this.buffer[this.frames + i] = sum / channels.length;
      }

      this.frames += take;
      offset += take;

      if (this.frames === this.buffer.length) {
        const chunk = this.buffer;
        this.buffer = new Float32Array(${CHUNK_FRAMES});
        this.frames = 0;
        this.port.postMessage(chunk, [chunk.buffer]);
      }
    }

    return true;
  }
}

registerProcessor('${WORKLET_NAME}', MaryCaptureProcessor);
`;
