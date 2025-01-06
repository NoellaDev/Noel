// Constants for audio processing
const MIN_CHUNK_SIZE = 512;
let globalPointer = 0;
let globalBuffer = new Float32Array(MIN_CHUNK_SIZE);

class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    console.log('VADProcessor: Initializing');
  }

  process(inputs, outputs, parameters) {
    const buffer = inputs[0][0];
    if (!buffer) {
      console.log('VADProcessor: No input buffer');
      return true;
    }

    console.log('VADProcessor: Processing buffer of length', buffer.length);

    if (buffer.length > MIN_CHUNK_SIZE) {
      // If the buffer is larger than the minimum chunk size, send the entire buffer
      console.log('VADProcessor: Sending full buffer');
      this.port.postMessage({ buffer });
    } else {
      const remaining = MIN_CHUNK_SIZE - globalPointer;
      if (buffer.length >= remaining) {
        // If the buffer is larger than (or equal to) the remaining space in the global buffer, copy the remaining space
        globalBuffer.set(buffer.subarray(0, remaining), globalPointer);

        // Send the global buffer
        console.log('VADProcessor: Sending accumulated buffer');
        this.port.postMessage({ buffer: globalBuffer });

        // Reset the global buffer and set the remaining buffer
        globalBuffer.fill(0);
        globalBuffer.set(buffer.subarray(remaining), 0);
        globalPointer = buffer.length - remaining;
      } else {
        // If the buffer is smaller than the remaining space in the global buffer, copy the buffer to the global buffer
        console.log('VADProcessor: Accumulating buffer');
        globalBuffer.set(buffer, globalPointer);
        globalPointer += buffer.length;
      }
    }

    return true; // Keep the processor alive
  }
}

registerProcessor("vad-processor", VADProcessor);