import { HelpTip } from "@kubebay/ui";
import { PAGE_HELP, docsUrl } from "../lib/help";

interface PageHelpProps {
  /** The page's route, as App.tsx declares it: the key into PAGE_HELP. */
  route: string;
  /** Names the page in "About …" instead of its entry's name, as for one kind's table. */
  name?: string;
  /** "end" when the ⓘ sits at the right edge, so the panel opens leftward. */
  align?: "start" | "end";
}

/** The ⓘ beside a page's title (root backlog #18): what it is, how it works, and its page in the manual. */
export function PageHelp({ route, name, align }: PageHelpProps) {
  const help = PAGE_HELP[route];
  if (!help) return null;
  return (
    <HelpTip label={`About ${name ?? help.name}`} align={align}>
      <p>{help.what}</p>
      <p className="muted">{help.how}</p>
      <a href={docsUrl(help.docs)} target="_blank" rel="noreferrer">
        Learn more in the docs →
      </a>
    </HelpTip>
  );
}
