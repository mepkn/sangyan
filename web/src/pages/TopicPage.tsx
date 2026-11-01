import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import { ChevronLeft, Menu as MenuIcon, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import { PageView } from "@/components/PageView";
import { Logo, SearchButton, UtilityButtons, useShell } from "@/components/Shell";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ancestors } from "@/lib/tree";
import { cn } from "@/lib/utils";

/** A topic: the sidebar tree on the left, the open page on the right. */
export function TopicPage() {
  const { slug = "", pageId } = useParams();
  const data = useQuery(api.nodes.topicTree, { slug });
  const { canEdit } = useShell();
  // The mobile drawer belongs to the page it was opened on, so opening a page closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const navOpen = navOpenOn === (pageId ?? "");
  const setNavOpen = (open: boolean) => setNavOpenOn(open ? (pageId ?? "") : null);

  const page = data?.nodes.find((n) => n._id === pageId && n.kind === "page");
  const trail = useMemo(() => {
    if (!data || !page) return [];
    const byId = new Map(data.nodes.map((n) => [n._id, n]));
    return [data.topic.title, ...ancestors(data.nodes, page._id).reverse().flatMap((id) => byId.get(id as typeof page._id)?.title ?? [])];
  }, [data, page]);

  useEffect(() => {
    document.title = page ? `${page.title} · ${data?.topic.title}` : data ? `${data.topic.title} · Sangyan` : "Sangyan";
    return () => void (document.title = "Sangyan");
  }, [page, data]);

  if (data === undefined) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (data === null) return <NotFound what="topic" />;

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r bg-sidebar transition-transform md:static md:translate-x-0",
          navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
        )}
      >
        <div className="flex h-12 items-center justify-between gap-2 px-3">
          <Logo />
          <UtilityButtons />
        </div>
        <div className="space-y-2 px-3 pb-2">
          <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" /> All topics
          </Link>
          <h2 className="truncate text-lg font-semibold tracking-tight">{data.topic.title}</h2>
          <SearchButton />
        </div>
        <Sidebar topic={data.topic} nodes={data.nodes} canEdit={canEdit} currentId={page?._id} />
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}

      <main className="flex min-w-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon-sm"
          className="fixed left-2 top-2.5 z-20 md:hidden"
          aria-label="Contents"
          onClick={() => setNavOpen(!navOpen)}
        >
          {navOpen ? <X /> : <MenuIcon />}
        </Button>
        {page ? (
          <PageView node={page} trail={trail} canEdit={canEdit} />
        ) : pageId ? (
          <NotFound what="page" />
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center text-muted-foreground">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{data.topic.title}</h1>
              <p className="mt-2">
                {data.nodes.some((n) => n.kind === "page")
                  ? "Pick a page from the sidebar."
                  : canEdit
                    ? "Add your first page with + in the sidebar, or right-click it."
                    : "No pages yet."}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 py-20 text-center">
      <div>
        <h1 className="text-2xl font-semibold">This {what} doesn't exist</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been deleted or renamed. <Link to="/" className="underline underline-offset-4">Go home</Link>
        </p>
      </div>
    </div>
  );
}
