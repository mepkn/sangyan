import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "react-router";
import { CircleHelp, LogIn, LogOut, Moon, Search, Sun } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Finder } from "@/components/Finder";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { mod } from "@/lib/keys";
import { isDark, toggleTheme } from "@/lib/theme";

interface ShellApi {
  canEdit: boolean;
  openFinder: () => void;
  openHelp: () => void;
}

const ShellContext = createContext<ShellApi>({ canEdit: false, openFinder: () => {}, openHelp: () => {} });

// eslint-disable-next-line react-refresh/only-export-components
export function useShell() {
  return useContext(ShellContext);
}

/** App-wide pieces: who can edit, the Ctrl+K finder and the Ctrl+/ help. */
export function Shell({ children }: { children: ReactNode }) {
  const viewer = useQuery(api.nodes.viewer);
  const [finder, setFinder] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinder((o) => !o);
      } else if (e.key === "/") {
        e.preventDefault();
        setHelp((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShellContext.Provider
      value={{ canEdit: viewer?.canEdit ?? false, openFinder: () => setFinder(true), openHelp: () => setHelp(true) }}
    >
      {children}
      <Finder open={finder} onOpenChange={setFinder} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
    </ShellContext.Provider>
  );
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <img src="/favicon.svg?v=2" alt="" className="size-6" />
      Sangyan
    </Link>
  );
}

export function SearchButton({ className }: { className?: string }) {
  const { openFinder } = useShell();
  return (
    <button
      onClick={openFinder}
      className={`flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground hover:text-foreground ${className ?? ""}`}
    >
      <Search className="size-3.5" />
      <span className="flex-1 text-left">Find a page</span>
      <Kbd>{mod} K</Kbd>
    </button>
  );
}

/** Theme, help and sign-in/out: small icon buttons. */
export function UtilityButtons() {
  const { canEdit, openHelp } = useShell();
  const { signOut } = useAuthActions();
  const [dark, setDark] = useState(isDark);
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" title="Toggle theme" onClick={() => setDark(toggleTheme())}>
        {dark ? <Sun /> : <Moon />}
      </Button>
      <Button variant="ghost" size="icon-sm" title={`Shortcuts (${mod}/)`} onClick={openHelp}>
        <CircleHelp />
      </Button>
      {canEdit ? (
        <Button variant="ghost" size="icon-sm" title="Sign out" onClick={() => void signOut()}>
          <LogOut />
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" title="Sign in to edit" render={<Link to="/signin" />}>
          <LogIn />
        </Button>
      )}
    </div>
  );
}
