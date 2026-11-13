"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { generateQuestions, suggestJobRoles, uploadResume } from "@/lib/api";
import { DIFFICULTIES, QUESTION_COUNTS } from "@/lib/constants";

export function ResumeUpload() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [role, setRole] = useState("");
    const [difficulty, setDifficulty] = useState("medium");
    const [count, setCount] = useState("10");
    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState("");
    const [error, setError] = useState("");
    const [suggestedRoles, setSuggestedRoles] = useState<string[]>([]);
    const [loadingRoles, setLoadingRoles] = useState(false);
    const [mode, setMode] = useState<"text" | "audio">("text");

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const chosen = e.target.files?.[0] || null;
        setFile(chosen);
        setSuggestedRoles([]);
        setRole("");
        if (!chosen) return;

        setLoadingRoles(true);
        try {
            const resume = await uploadResume(chosen);
            if (resume.resumeId) {
                const roles = await suggestJobRoles().catch(() => []);
                if (roles.length) setSuggestedRoles(roles);
            }
        } catch {
            // silently ignore — user can still type a role
        } finally {
            setLoadingRoles(false);
        }
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        const jobRole = role.trim();
        if (!file) return setError("Please choose a resume first.");
        if (!jobRole) return setError("Job role is required.");
        setBusy(true);
        setError("");
        setStage("AI is analyzing your resume...");
        try {
            const resume = await uploadResume(file, jobRole);
            if (!resume.resumeId) throw new Error("Resume upload did not return a resume ID.");
            const result = await generateQuestions({
                resumeId: resume.resumeId,
                jobRole,
                difficulty,
                questionCount: Number(count),
                interviewType: mode,
            });
            if (!result.interviewId || !result.questions.length)
                throw new Error("The server did not return interview questions.");
            localStorage.setItem("interview", JSON.stringify({ ...result, mode }));
            router.push(`/interview/${result.interviewId}/questions`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not create interview.");
        } finally {
            setBusy(false);
            setStage("");
        }
    }

    return (
        <div className="narrow-page">
            <div className="page-heading">
                <div className="eyebrow">01 / Build your session</div>
                <h1>Set up your practice.</h1>
                <p className="muted">
                    Add your resume, choose the role you want, and begin a focused practice session.
                </p>
            </div>
            <form className="panel stack" onSubmit={submit}>

                {/* Resume upload */}
                <div className="field">
                    <span>Your resume (PDF, DOC, DOCX)</span>
                    <label className={`file-picker${file ? " has-file" : ""}`}>
                        <input type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} disabled={busy} />
                        {file ? <><FileText size={18} /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB selected</small></span><b>Change file</b></> : <><Upload size={18} /><span><strong>Choose your resume</strong><small>PDF, DOC or DOCX</small></span><b>Browse</b></>}
                    </label>
                </div>

                {/* Job role — select after upload, plain input before */}
                <label className="field">
                    Job role from your resume
                    {loadingRoles ? (
                        <input disabled placeholder="Uploading resume and finding matching roles..." />
                    ) : suggestedRoles.length > 0 ? (
                        <select
                            key="role-select"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            required
                        >
                            <option value="">Select a role</option>
                            {suggestedRoles.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            key="role-input"
                            name="jobRole"
                            value={role ?? ""}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="Upload resume to see suggested roles"
                            required
                        />
                    )}
                </label>
                <div className="form-grid">
                    <label className="field">
                        Difficulty
                        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                            {DIFFICULTIES.map((item) => (
                                <option key={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        Questions
                        <select value={count} onChange={(e) => setCount(e.target.value)}>
                            {QUESTION_COUNTS.map((item) => (
                                <option key={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                </div>

                {/* Interview type toggle */}
                <fieldset className="mode-picker">
                    <legend>Practice format</legend>
                    <div>
                        <label>
                            <input
                                type="radio"
                                name="mode"
                                value="text"
                                checked={mode === "text"}
                                onChange={() => setMode("text")}
                            />
                            Write your answers
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="mode"
                                value="audio"
                                checked={mode === "audio"}
                                onChange={() => setMode("audio")}
                            />
                            Speak your answers
                        </label>
                    </div>
                </fieldset>

                {error && <div className="notice error">{error}</div>}

                <button className="button primary" disabled={busy || loadingRoles}>
                    {busy ? stage : "Generate interview"}
                </button>
            </form>
        </div>
    );
}
