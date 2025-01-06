import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Mic, Square } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js';
// Import the worker directly
import SpeechWorker from './speech/worker?worker';

// Constants for audio processing
const SAMPLE_RATE = 16000;

// Separate button component
export const AudioButton = ({
  isRecording,
  onClick,
}: {
  isRecording: boolean;
  onClick: () => void;
}) => (
  <Button
    type="button"
    size="icon"
    variant="ghost"
    onClick={onClick}
    className={`text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-800 flex-shrink-0`}
  >
    {isRecording ? <Square size={20} /> : <Mic size={20} />}
  </Button>
);

// Separate waveform component with its own state management
export const AudioWaveform = React.forwardRef<
  HTMLDivElement,
  {
    isRecording: boolean;
    onTranscription?: (text: string) => void;
    className?: string;
  }
>(({ isRecording, onTranscription, className = '' }, ref) => {
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const recordPluginRef = useRef<any>(null);
  const [progress, setProgress] = useState('00:00');
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const handleRecordProgress = useCallback((time: number) => {
    const minutes = Math.floor((time % 3600000) / 60000);
    const seconds = Math.floor((time % 60000) / 1000);
    const formattedTime = [minutes, seconds]
      .map(v => v < 10 ? '0' + v : v)
      .join(':');
    setProgress(formattedTime);
  }, []);

  useEffect(() => {
    const container = ref as React.RefObject<HTMLDivElement>;
    if (!container.current) return;

    console.log('Initializing WaveSurfer');
    const wavesurfer = WaveSurfer.create({
      container: container.current,
      waveColor: 'rgb(99, 102, 241)',
      progressColor: 'rgb(79, 70, 229)',
      height: 26,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      minPxPerSec: 50,
      plugins: [
        RecordPlugin.create({
          renderRecordedAudio: false,
          scrollingWaveform: false,
          continuousWaveform: true,
          continuousWaveformDuration: 30
        })
      ]
    });

    const recordPlugin = wavesurfer.plugins[0];
    console.log('WaveSurfer initialized with record plugin:', recordPlugin);

    recordPlugin.on('record-progress', (time: number) => {
      console.log('Record progress:', time);
      handleRecordProgress(time);
    });

    wavesurferRef.current = wavesurfer;
    recordPluginRef.current = recordPlugin;

    // Initialize Web Worker for speech recognition
    console.log('Initializing Web Worker');
    const worker = new SpeechWorker();

    worker.onmessage = (event) => {
      const { type, message } = event.data;
      console.log('Worker message:', type, message);
      if (type === 'output' && onTranscription) {
        onTranscription(message);
      }
    };

    workerRef.current = worker;

    // Initialize AudioContext
    console.log('Initializing AudioContext');
    const audioContext = new AudioContext({
      sampleRate: SAMPLE_RATE,
      latencyHint: 'interactive',
    });
    
    audioContextRef.current = audioContext;

    return () => {
      console.log('Cleaning up audio resources');
      wavesurfer.destroy();
      workerRef.current?.terminate();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (processorRef.current) {
        processorRef.current.disconnect();
      }
      audioContextRef.current?.close();
      wavesurferRef.current = null;
      recordPluginRef.current = null;
      workerRef.current = null;
      audioContextRef.current = null;
      processorRef.current = null;
      streamRef.current = null;
      sourceRef.current = null;
    };
  }, [ref, onTranscription, handleRecordProgress]);

  useEffect(() => {
    const recordPlugin = recordPluginRef.current;
    const audioContext = audioContextRef.current;
    const worker = workerRef.current;
    
    if (!recordPlugin || !audioContext || !worker) return;

    const handleRecording = async () => {
      if (isRecording) {
        try {
          console.log('Starting recording');
          // Get permission and start recording
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              sampleRate: SAMPLE_RATE,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true
            } 
          });
          console.log('Got media stream:', stream);
          
          streamRef.current = stream;

          // Load audio worklet
          console.log('Loading audio worklet');
          await audioContext.audioWorklet.addModule(
            new URL('./speech/processor.js', import.meta.url)
          );
          
          // Create audio processor
          console.log('Creating audio processor');
          const processor = new AudioWorkletNode(audioContext, 'vad-processor');
          processor.port.onmessage = (event) => {
            const { buffer } = event.data;
            console.log('Processor message, buffer length:', buffer?.length);
            if (buffer && worker) {
              worker.postMessage({ buffer });
            }
          };
          processorRef.current = processor;

          // Connect the audio graph
          console.log('Connecting audio graph');
          const source = audioContext.createMediaStreamSource(stream);
          sourceRef.current = source;
          source.connect(processor);

          // Start WaveSurfer recording
          console.log('Starting WaveSurfer recording');
          await recordPlugin.startRecording();

          // Tell worker to start recording
          console.log('Sending start command to worker');
          worker.postMessage({ command: 'start' });
        } catch (err) {
          console.error('Failed to start recording:', err);
        }
      } else {
        try {
          console.log('Stopping recording');
          if (recordPlugin.isRecording()) {
            await recordPlugin.stopRecording();
            setProgress('00:00');
          }

          // Tell worker to stop recording and transcribe
          console.log('Sending stop command to worker');
          worker.postMessage({ command: 'stop' });

          // Stop the media stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          // Disconnect audio nodes
          if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
          }
          if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
          }
        } catch (err) {
          console.error('Failed to stop recording:', err);
        }
      }
    };

    handleRecording();
  }, [isRecording]);

  return (
      <div
          className={`flex-grow transition-all duration-200 ${
              isRecording ? 'opacity-100 h-[26px]' : 'opacity-0 h-0'
          } ${className}`}
      >
        <div ref={ref} className="w-full h-full"/>
      </div>
  );
});

AudioWaveform.displayName = 'AudioWaveform';

// Main ClientSpeechRecorder component
export function ClientSpeechRecorder({onTranscription, containerClassName}: {
  onTranscription: (text: string) => void;
  containerClassName?: string;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const micContainerRef = useRef<HTMLDivElement>(null);

  const handleToggleRecording = useCallback(() => {
    setIsRecording(prev => !prev);
  }, []);

  return (
    <div className={`flex items-center gap-2 ${containerClassName || ''}`}>
        <AudioWaveform
          ref={micContainerRef}
          isRecording={isRecording}
          onTranscription={onTranscription}
          className="flex-grow"
        />
      <AudioButton isRecording={isRecording} onClick={handleToggleRecording} />
    </div>
  );
}