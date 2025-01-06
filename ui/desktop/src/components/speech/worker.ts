// worker-wrapper.ts
import {AutoModel, Tensor, pipeline} from "@huggingface/transformers";

// Constants for audio processing
const SAMPLE_RATE = 16000;
const SPEECH_THRESHOLD = 0.5;
const MAX_BUFFER_DURATION = 30;
const SPEECH_PAD_SAMPLES = 1600;
const MAX_NUM_PREV_BUFFERS = 4;

// Initialize worker context
const ctx = self as unknown as Worker;

// Chain promises for inference
let inferenceChain = Promise.resolve();

// Global audio buffer
const BUFFER = new Float32Array(MAX_BUFFER_DURATION * SAMPLE_RATE);
let bufferPointer = 0;

// VAD state
let state: Tensor;
let silero_vad: any;
let transcriber: any;
let sr: Tensor;
let isActive = false;
let prevBuffers: Float32Array[] = [];

async function initializeModels() {
    console.log('Worker: Starting initialization');
    const device = (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
    console.log('Worker: Using device:', device);
    ctx.postMessage({type: "info", message: `Using device: "${device}"`});
    ctx.postMessage({
        type: "info",
        message: "Loading models...",
        duration: "until_next",
    });

    // Load VAD model
    console.log('Worker: Loading VAD model');
    silero_vad = await AutoModel.from_pretrained(
        "onnx-community/silero-vad",
        {
            config: {model_type: "custom"},
            dtype: "fp32",
        },
    ).catch((error) => {
        console.error('Worker: Failed to load VAD model:', error);
        ctx.postMessage({error});
        throw error;
    });
    console.log('Worker: VAD model loaded');

    // Configure model based on device
    const DEVICE_DTYPE_CONFIGS = {
        webgpu: {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
        },
        wasm: {
            encoder_model: "fp32",
            decoder_model_merged: "q8",
        },
    };

    // Initialize transcriber
    console.log('Worker: Loading transcriber model');
    transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/moonshine-base-ONNX",
        {
            device,
            dtype: DEVICE_DTYPE_CONFIGS[device],
        },
    ).catch((error) => {
        console.error('Worker: Failed to load transcriber model:', error);
        ctx.postMessage({error});
        throw error;
    });
    console.log('Worker: Transcriber model loaded');

    // Initialize VAD state
    sr = new Tensor("int64", [SAMPLE_RATE], []);
    state = new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);

    // Warm up the model
    console.log('Worker: Warming up models');
    await transcriber(new Float32Array(SAMPLE_RATE));
    console.log('Worker: Models warmed up');
    ctx.postMessage({type: "status", status: "ready", message: "Ready!"});
}

/**
 * Voice Activity Detection
 */
async function vad(buffer: Float32Array): Promise<boolean> {
    console.log('VAD: Processing buffer of length:', buffer.length);
    const input = new Tensor("float32", buffer, [1, buffer.length]);

    const {stateN, output} = await (inferenceChain = inferenceChain.then(() =>
        silero_vad({input, sr, state}),
    ));
    state = stateN;

    const isSpeech = output.data[0];
    console.log('VAD: Speech probability:', isSpeech);
    return isSpeech > SPEECH_THRESHOLD;
}

/**
 * Transcribe audio
 */
const transcribe = async (buffer: Float32Array, data: any) => {
    console.log('Transcribe: Processing buffer of length:', buffer.length);
    const {text} = await (inferenceChain = inferenceChain.then(() =>
        transcriber(buffer),
    ));
    console.log('Transcribe: Result:', text);
    ctx.postMessage({type: "output", buffer, message: text, ...data});
};

const reset = (offset = 0) => {
    console.log('Reset: Resetting buffer with offset:', offset);
    BUFFER.fill(0, offset);
    bufferPointer = offset;
    prevBuffers = [];
};

const dispatchForTranscription = (overflow?: Float32Array) => {
    console.log('Dispatch: Processing transcription');
    const now = Date.now();
    const duration = (bufferPointer / SAMPLE_RATE) * 1000;
    const end = now;
    const start = end - duration;
    const overflowLength = overflow?.length ?? 0;

    const buffer = BUFFER.slice(0, bufferPointer + SPEECH_PAD_SAMPLES);

    const prevLength = prevBuffers.reduce((acc, b) => acc + b.length, 0);
    const paddedBuffer = new Float32Array(prevLength + buffer.length);
    let offset = 0;
    for (const prev of prevBuffers) {
        paddedBuffer.set(prev, offset);
        offset += prev.length;
    }
    paddedBuffer.set(buffer, offset);
    console.log('Dispatch: Final buffer length:', paddedBuffer.length);
    transcribe(paddedBuffer, {start, end, duration});

    if (overflow) {
        BUFFER.set(overflow, 0);
    }
    reset(overflowLength);
};

// Initialize models
initializeModels().catch(error => {
    console.error('Worker: Failed to initialize:', error);
    ctx.postMessage({type: "error", error});
});

// Handle incoming messages in worker context
ctx.onmessage = async (event) => {
    const {buffer, command} = event.data;

    if (command === 'stop' && isActive) {
        console.log('Worker: Received stop command');
        isActive = false;
        if (bufferPointer > 0) {
            dispatchForTranscription();
        }
        return;
    }

    if (command === 'start') {
        console.log('Worker: Received start command');
        isActive = true;
        reset();
        return;
    }

    if (!isActive || !buffer) return;

    console.log('Worker: Received buffer of length:', buffer.length);
    const isSpeech = await vad(buffer);
    console.log('Worker: Speech detected:', isSpeech);

    if (!isSpeech) {
        if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) {
            prevBuffers.shift();
        }
        prevBuffers.push(buffer);
        return;
    }

    const remaining = BUFFER.length - bufferPointer;
    if (buffer.length >= remaining) {
        BUFFER.set(buffer.subarray(0, remaining), bufferPointer);
        bufferPointer += remaining;
        const overflow = buffer.subarray(remaining);
        dispatchForTranscription(overflow);
        return;
    } else {
        BUFFER.set(buffer, bufferPointer);
        bufferPointer += buffer.length;
    }
};
