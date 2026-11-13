"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import QuestionCard from "@/components/interview/QuestionCard";
import AnswerRecorder from "@/components/interview/AnswerRecorder";
import ProctorCamera from "@/components/interview/ProctorCamera";
import ReportView from "@/components/interview/ReportView";
import { getProfile, getReport, submitAnswer } from "@/lib/api";
import type { InterviewReport, Question } from "@/types";

interface SavedInterview {
  questions?: Question[];
  mode?: "text" | "audio";
}

function readSavedInterview(): SavedInterview | null {
  const value = localStorage.getItem("interview");
  if (!value) return null;
  try {
    return JSON.parse(value) as SavedInterview;
  } catch {
    localStorage.removeItem("interview");
    return null;
  }
}

export function QuestionsPage({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(false);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [integrityWarning, setIntegrityWarning] = useState("");
  const [integrityEvents, setIntegrityEvents] = useState(0);
  const [terminated, setTerminated] = useState(false);

  const hasStartedRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const lastAnswerRef = useRef<{ answer: string; timeTaken: number } | null>(null);
  const terminatedRef = useRef(false);

  useEffect(() => {
    const saved = readSavedInterview();
    if (saved) {
      queueMicrotask(() => {
        setQuestions(Array.isArray(saved.questions) ? saved.questions : []);
        setMode(saved.mode === "audio" ? "audio" : "text");
      });
    }
  }, []);

  useEffect(() => {
    if (!cameraPermission || hasStartedRef.current || intervalRef.current !== null) return;
    setCountdown(5);
    intervalRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          if (!hasStartedRef.current) {
            hasStartedRef.current = true;
            setInterviewStarted(true);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cameraPermission]);

  useEffect(() => {
    if (!interviewStarted) return;
    function terminate() {
      if (terminatedRef.current) return;
      terminatedRef.current = true;
      setTerminated(true);
      localStorage.removeItem("interview");
    }
    function handleVisibility() {
      if (document.hidden) terminate();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [interviewStarted]);

  useEffect(() => {
    function flagActivity(message: string) {
      setIntegrityEvents((c) => c + 1);
      setIntegrityWarning(message);
    }
    window.addEventListener("blur", () => flagActivity("The interview window lost focus. Please keep the interview window active."));
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) flagActivity("Fullscreen was exited. Please keep the interview window visible."); });
    document.addEventListener("copy", () => flagActivity("Copy or paste activity was detected during the interview."));
    document.addEventListener("paste", () => flagActivity("Copy or paste activity was detected during the interview."));
  }, []);

  const question = questions[index];

  async function next(answer: string, timeTaken: number, attempt = 0) {
    lastAnswerRef.current = { answer, timeTaken };
    setBusy(true);
    setError("");
    try {
      await submitAnswer(interviewId, { questionId: question.id, answer, timeTaken });
      lastAnswerRef.current = null;
      if (index === questions.length - 1) {
        router.push(`/interview/${interviewId}/report`);
      } else {
        setIndex(index + 1);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const isRateLimited = /429|quota|rate limit/i.test(message);
      if (isRateLimited && attempt < 2) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        return next(answer, timeTaken, attempt + 1);
      }
      setError(isRateLimited
        ? "The interview service is temporarily busy. Your answer was recorded — please wait a moment and try submitting again."
        : message || "Could not submit your answer. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (terminated) {
    return (
      <div className="interview-layout">
        <section>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "60px 24px", textAlign: "center" }}>
            <AlertTriangle size={48} color="#b54708" />
            <h2 style={{ margin: 0, color: "#b54708" }}>Interview Terminated</h2>
            <p style={{ maxWidth: 420, margin: 0, color: "#555", fontSize: 15 }}>
              Your interview was automatically closed because a tab change was detected.
            </p>
            <button className="button primary" style={{ marginTop: 8 }} onClick={() => router.push("/interview/new")}>
              Start a new interview
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="interview-layout">
      <section>
        <div className="section-heading">
          <div>
            <div className="eyebrow">02 / Live interview</div>
            <h2>{cameraActive ? "Stay present. Stay specific." : "Camera access required."}</h2>
          </div>
        </div>
        {!cameraPermission && !error && (
          <div className="notice error">
            Enable camera access to begin — the interview starts automatically once access is granted.
          </div>
        )}
        {integrityWarning && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 15px", marginBottom: 16, border: "1px solid #fecdca", borderRadius: 9, background: "#fff6ed", color: "#b54708", fontSize: 13 }}>
            <AlertTriangle size={19} />
            <div>
              <strong style={{ display: "block" }}>Interview integrity warning</strong>
              <span style={{ display: "block", marginTop: 3 }}>{integrityWarning} Event {integrityEvents} recorded.</span>
            </div>
            <button style={{ marginLeft: "auto", border: 0, background: "none", color: "#b54708", fontSize: 12, fontWeight: 700 }} onClick={() => setIntegrityWarning("")}>Dismiss</button>
          </div>
        )}
        {error && (
          <div className="notice error">
            {error}
            {lastAnswerRef.current && (
              <button className="button secondary" style={{ marginLeft: 12 }} onClick={() => lastAnswerRef.current && next(lastAnswerRef.current.answer, lastAnswerRef.current.timeTaken)} disabled={busy}>Retry</button>
            )}
          </div>
        )}
        {question && interviewStarted && cameraActive ? (
          <>
            <QuestionCard question={question} index={index} total={questions.length} />
            <AnswerRecorder
              key={question.id}
              onSubmit={next}
              busy={busy}
              interviewId={interviewId}
              questionId={question.id}
              questionText={question.text}
              mode={mode}
            />
          </>
        ) : (
          <div className="panel">
            {!cameraPermission
              ? "Camera permission is required before the interview can begin."
              : countdown !== null
                ? `Interview starting in ${countdown}...`
                : !cameraActive
                  ? "Starting interview and proctoring..."
                  : <> No questions found. <a href="/interview/new">Start a new interview</a> </>}
          </div>
        )}
      </section>
      <ProctorCamera
        interviewId={interviewId}
        startRequested={interviewStarted}
        onStatus={setCameraActive}
        onPermission={setCameraPermission}
      />
    </div>
  );
}

export function ReportPage({ interviewId }: { interviewId: string }) {
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [error, setError] = useState("");

  async function loadReport() {
    setError("");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const latest = await getReport(interviewId);
        if (latest.questionResults.length || latest.overallScore > 0 || latest.strengths.length || latest.improvements.length) {
          const profile = await getProfile().catch(() => null);
          setReport(profile ? { ...latest, candidate: { ...latest.candidate, name: latest.candidate?.name || profile.name, email: latest.candidate?.email || profile.email, profilePicture: latest.candidate?.profilePicture || profile.profilePicture } } : latest);
          return;
        }
      } catch { }
      if (attempt < 5) await new Promise((r) => window.setTimeout(r, 2000));
    }
    setError("The interview report is not available until the interview is completed.");
  }

  useEffect(() => { queueMicrotask(() => void loadReport()); }, [interviewId]);

  if (error) return <div className="notice error">{error}</div>;
  return report ? <ReportView report={report} /> : <div className="loading">Preparing your completed report...</div>;
}
