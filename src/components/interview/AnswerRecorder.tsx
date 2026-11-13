"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, MicOff } from "lucide-react";
import { transcribeAudioAnswer } from "@/lib/api";

interface Props { onSubmit: (answer: string, timeTaken: number) => void; busy: boolean; interviewId: string; questionId: string; questionText: string; mode: "text" | "audio"; }
type VoiceState = "preparing" | "speaking" | "ready" | "listening" | "transcribing" | "review";
const SILENCE_DELAY_MS = 2200;
const SPEECH_THRESHOLD = 12;

export default function AnswerRecorder({ onSubmit, busy, interviewId, questionId, questionText, mode }: Props) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>(mode === "audio" ? "preparing" : "ready");
  const startedAtRef = useRef(Date.now()); const turnRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null); const streamRef = useRef<MediaStream | null>(null); const warmedStreamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null); const frameRef = useRef<number | null>(null); const chunksRef = useRef<Blob[]>([]); const submitLockRef = useRef(false);

  const current = (turn: number) => turn === turnRef.current;
  function stopTracks(stream: MediaStream | null) { stream?.getTracks().forEach((track) => track.stop()); }
  function cleanupAnalysis() { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; if (contextRef.current) void contextRef.current.close(); contextRef.current = null; }
  function cleanupAll() { window.speechSynthesis?.cancel(); if (recorderRef.current?.state === "recording") recorderRef.current.stop(); cleanupAnalysis(); stopTracks(streamRef.current); streamRef.current = null; recorderRef.current = null; stopTracks(warmedStreamRef.current); warmedStreamRef.current = null; }

  useEffect(() => { const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!busy) submitLockRef.current = false; }, [busy]);
  useEffect(() => {
    turnRef.current += 1; const turn = turnRef.current;
    startedAtRef.current = Date.now(); setSeconds(0); setAnswer(""); setError(""); cleanupAll();
    if (mode === "audio") { setVoiceState("preparing"); window.setTimeout(() => speakQuestion(turn), 150); } else setVoiceState("ready");
    return () => { if (current(turn)) cleanupAll(); };
    // questionId identifies one isolated turn. Stale media callbacks are ignored using turnRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, mode]);

  function speakQuestion(turn = turnRef.current) {
    if (!current(turn) || !("speechSynthesis" in window) || !questionText.trim()) {
      if (current(turn)) void startRecording(turn);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(questionText);
    const preferredVoice = window.speechSynthesis.getVoices().find((voice) => /^en(-|_)/i.test(voice.lang) && /google|zira|samantha|aria/i.test(voice.name));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = "en-US"; utterance.rate = 0.94;
    utterance.onend = () => { if (current(turn)) void startRecording(turn); };
    utterance.onerror = () => { if (current(turn)) void startRecording(turn); };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setVoiceState("speaking");
  }
  async function startRecording(turn = turnRef.current) {
    if (!current(turn) || recorderRef.current?.state === "recording") return;
    setError("");
    try {
      const stream = warmedStreamRef.current || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); warmedStreamRef.current = null;
      if (!current(turn)) { stopTracks(stream); return; }
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); recorderRef.current = recorder; chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { const recording = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); cleanupAnalysis(); stopTracks(streamRef.current); streamRef.current = null; recorderRef.current = null; if (!current(turn)) return; if (!recording.size) { setVoiceState("review"); setError("We did not hear an answer. Try speaking again or type your answer."); return; } void previewTranscript(recording, turn); };
      recorder.start(250); setVoiceState("listening"); beginSilenceDetection(stream, turn);
    } catch { if (current(turn)) { setVoiceState("review"); setError("Microphone permission is unavailable. You can type your answer below."); } }
  }
  function beginSilenceDetection(stream: MediaStream, turn: number) {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass(); contextRef.current = context; const analyser = context.createAnalyser(); analyser.fftSize = 512; context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount); let speechStarted = false; let silentSince: number | null = null;
    const inspect = () => { if (!current(turn) || recorderRef.current?.state !== "recording") return; analyser.getByteFrequencyData(samples); const level = samples.reduce((sum, value) => sum + value, 0) / samples.length; if (level > SPEECH_THRESHOLD) { speechStarted = true; silentSince = null; } else if (speechStarted) { silentSince ??= Date.now(); if (Date.now() - silentSince >= SILENCE_DELAY_MS) { stopRecording(turn); return; } } frameRef.current = requestAnimationFrame(inspect); };
    inspect();
  }
  function stopRecording(turn = turnRef.current) { if (current(turn) && recorderRef.current?.state === "recording") recorderRef.current.stop(); }
  async function previewTranscript(recording: Blob, turn: number) { if (!current(turn)) return; setVoiceState("transcribing"); try { const transcript = await transcribeAudioAnswer(interviewId, questionId, recording); if (current(turn)) { setAnswer(transcript); setVoiceState("review"); } } catch (err) { if (current(turn)) { setVoiceState("review"); setError(err instanceof Error ? `${err.message} You can type your answer instead.` : "Audio could not be converted. Type your answer instead."); } } }
  function submit() { const text = answer.trim(); if (!text) { setError("Type or record an answer before submitting."); return; } if (submitLockRef.current || busy) return; submitLockRef.current = true; onSubmit(text, Math.floor((Date.now() - startedAtRef.current) / 1000)); }

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const voiceCopy: Record<VoiceState, string> = { preparing: "Getting the interviewer ready", speaking: "Listen to the question", ready: "Start voice mode", listening: "Listening to your answer", transcribing: "Making your answer editable", review: "Review your answer" };
  if (mode === "text") return <div className="answer-box"><div className="answer-toolbar"><span>Your answer</span><span>{time} spent</span></div><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write a specific, structured answer based on your experience." />{error && <div className="notice error">{error}</div>}<button className="button primary" disabled={busy} onClick={submit}>{busy ? "Submitting..." : "Submit answer"}</button></div>;

  const isWorking = voiceState === "preparing" || voiceState === "transcribing";
  return <section className={`voice-room is-${voiceState}`}>
    <div className="voice-room-topline"><span className="voice-room-label"><i /> Voice interview</span><span>{time}</span></div>
    <div className="voice-orb-wrap" aria-live="polite"><span className="voice-orbit voice-orbit-one" /><span className="voice-orbit voice-orbit-two" /><div className="voice-orb" aria-hidden="true">{isWorking ? <Loader2 size={30} className="spin" /> : <Mic size={31} />}</div></div>
    <div className="voice-status"><strong>{voiceCopy[voiceState]}</strong><span>{voiceState === "speaking" ? "Recording starts by itself when the question finishes." : voiceState === "listening" ? "Finish your thought, then pause for a moment." : voiceState === "review" ? "You can correct the text before submitting it." : "The question remains visible above."}</span></div>
    {voiceState === "listening" && <button className="voice-stop" onClick={() => stopRecording()}><MicOff size={16} /> Finish answer now</button>}
    {(voiceState === "review" || answer || error) && <div className="voice-review"><label>Your answer <span>Editable</span></label><textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setError(""); }} placeholder="Your recorded answer will appear here. You can also type." /></div>}
    {error && <div className="voice-error">{error}</div>}
    <div className="voice-actions"><span className="voice-auto-note">Questions play automatically</span><button className="button primary" onClick={submit} disabled={busy || voiceState === "listening" || isWorking || !answer.trim()}><Check size={16} /> {busy ? "Submitting..." : "Confirm answer"}</button></div>
  </section>;
}
