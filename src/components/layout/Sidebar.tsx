"use client";
import Link from "next/link";
import { LayoutDashboard, LogOut, Plus, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@/types";
import { clearAuth, getStoredUser } from "@/lib/auth";
const items = [["/dashboard", "Dashboard", LayoutDashboard], ["/interview/new", "New interview", Plus], ["/profile", "Profile", UserRound]] as const;
export default function Sidebar() { const path = usePathname(); const router = useRouter(); const [user, setUser] = useState<User | null>(null); useEffect(() => { queueMicrotask(() => setUser(getStoredUser())); }, []); return <aside className="sidebar"><div className="brand"><span>IS</span> Interview Studio</div><div className="user-chip"><div className="avatar">{user?.name?.slice(0, 2).toUpperCase() || "ME"}</div><div><strong>{user?.name || "Candidate"}</strong><small>{user?.email || "Interview workspace"}</small></div></div><nav>{items.map(([href, label, Icon]) => <Link className={path === href || (href !== "/dashboard" && path.startsWith(href)) ? "active" : ""} href={href} key={href}><Icon size={17} />{label}</Link>)}</nav><button className="logout" onClick={() => { clearAuth(); router.push("/login"); }}><LogOut size={17} />Log out</button></aside>; }
