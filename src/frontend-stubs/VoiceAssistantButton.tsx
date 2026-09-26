/**
 * VoiceAssistantButton — the primary (often only) control on the farmer's home
 * screen. Extreme-accessibility rules:
 *   - One giant target, no text required to operate it.
 *   - Colour + motion carry the state, not words: red pulse = recording,
 *     spinner = thinking, green pulse = speaking back.
 *   - Fully hands-off after the tap: record -> upload -> auto-play the reply.
 *
 * React DOM (web) reference implementation. On React Native swap MediaRecorder
 * for expo-av Recording and the <div>/<audio> for <Pressable>/expo-av Sound;
 * the state machine below stays identical.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { askVoiceAssistant } from './api';
import type { VoiceQueryResponseDto } from './types';

type VoiceState = 'IDLE' | 'RECORDING' | 'PROCESSING' | 'PLAYING';

interface VoiceAssistantButtonProps {
  /** Optional hook for showing captions / logging; UI itself needs no text. */
  onResult?: (result: VoiceQueryResponseDto) => void;
  onError?: (error: unknown) => void;
}

export function VoiceAssistantButton({ onResult, onError }: VoiceAssistantButtonProps) {
  const [state, setState] = useState<VoiceState>('IDLE');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Release the mic + any playing clip if the component unmounts mid-flow.
  useEffect(() => {
    return () => {
      stopStream(recorderRef.current);
      audioRef.current?.pause();
    };
  }, []);

  const playReply = useCallback((url: string) => {
    const audio = new Audio(url);
    audioRef.current = audio;
    setState('PLAYING');
    audio.onended = () => setState('IDLE');
    audio.onerror = () => setState('IDLE');
    void audio.play().catch(() => setState('IDLE')); // autoplay may need the tap gesture
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);

      recorder.onstop = async () => {
        stopStream(recorder);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setState('PROCESSING');
        try {
          const result = await askVoiceAssistant(blob);
          onResult?.(result);
          playReply(result.audioReplyUrl);
        } catch (err) {
          onError?.(err);
          setState('IDLE');
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setState('RECORDING');
    } catch (err) {
      onError?.(err); // mic permission denied / unavailable
      setState('IDLE');
    }
  }, [onError, onResult, playReply]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop(); // triggers onstop -> upload
  }, []);

  // One tap toggles record; during PROCESSING/PLAYING the button is inert.
  const onPress = useCallback(() => {
    if (state === 'IDLE') void startRecording();
    else if (state === 'RECORDING') stopRecording();
  }, [state, startRecording, stopRecording]);

  const visual = VISUALS[state];

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={visual.label}
      aria-live="polite"
      disabled={state === 'PROCESSING'}
      style={{ ...circleStyle, backgroundColor: visual.color, animation: visual.animation }}
    >
      <span aria-hidden style={{ fontSize: 96, lineHeight: 1 }}>
        {visual.glyph}
      </span>
    </button>
  );
}

/** Per-state presentation. Glyphs are large + universal; label is for a11y tech. */
const VISUALS: Record<VoiceState, { color: string; glyph: string; label: string; animation: string }> = {
  IDLE: { color: '#1f7a3d', glyph: '🎤', label: 'Tap to ask a question', animation: 'none' },
  RECORDING: { color: '#d32f2f', glyph: '⏺', label: 'Listening — tap to stop', animation: 'kr-pulse 1s infinite' },
  PROCESSING: { color: '#616161', glyph: '⏳', label: 'Thinking', animation: 'kr-spin 1.2s linear infinite' },
  PLAYING: { color: '#2e7d32', glyph: '🔊', label: 'Answering', animation: 'kr-pulse 1s infinite' },
};

const circleStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  borderRadius: '50%',
  border: 'none',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
};

function stopStream(recorder: MediaRecorder | null): void {
  recorder?.stream.getTracks().forEach((t) => t.stop());
}

/*
  Global keyframes to register once in the app shell:
    @keyframes kr-pulse { 0%,100% { transform: scale(1); opacity: 1; }
                          50%     { transform: scale(1.08); opacity: 0.85; } }
    @keyframes kr-spin  { to { transform: rotate(360deg); } }
*/

