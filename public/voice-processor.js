// AudioWorklet processor for voice capture
// Accumulates samples to target chunk size, calculates RMS, converts to Int16LE
class VoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = options?.processorOptions?.chunkSize || 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];

      if (this.bufferIndex >= this.chunkSize) {
        let sum = 0;
        for (let j = 0; j < this.chunkSize; j++) {
          sum += this.buffer[j] * this.buffer[j];
        }
        const rms = Math.sqrt(sum / this.chunkSize);

        const int16 = new Int16Array(this.chunkSize);
        for (let j = 0; j < this.chunkSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this.port.postMessage({ rms, audio: int16.buffer }, [int16.buffer]);

        this.buffer = new Float32Array(this.chunkSize);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('voice-processor', VoiceProcessor);
