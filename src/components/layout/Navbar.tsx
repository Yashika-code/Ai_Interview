"use client";
import { Menu } from "lucide-react";
export default function Navbar({ onMenu }: { onMenu: () => void }) { return <header className="navbar"><button className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><span className="eyebrow">Your practice workspace</span><span className="navbar-status"><i /> Ready when you are</span></header>; }
