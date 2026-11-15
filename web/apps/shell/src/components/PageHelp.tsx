import { HelpTip } from "@kubebay/ui";
import { CARD_HELP, PAGE_HELP, docsUrl, type PageHelpEntry } from "../lib/help";

type Align = "start" | "end";

function EntryTip({ entry, name, align }: { entry: PageHelpEntry; name?: string; align?: Align }) {
  return (
    <HelpTip label={`About ${name ?? entry.name}`} align={align}>
      <p>{entry.what}</p>
      <p className="muted">{entry.how}</p>
      <a href={docsUrl(entry.docs)} target="_blank" rel="noreferrer">
        Learn more in the docs →
      </a>
    </HelpTip>
  );
}

interface PageHelpProps {
  /** The page's route, as App.tsx declares it: the key into PAGE_HELP. */
  route: string;
  /** Names the page in "About …" instead of its entry's name, as for one kind's table. */
  name?: string;
  /** "end" when the ⓘ sits at the right edge, so the panel opens leftward. */
  align?: Align;
}

/** The ⓘ beside a page's title (root backlog #18): what it is, how it works, and its page in the manual. */
export function PageHelp({ route, name, align }: PageHelpProps) {
  const help = PAGE_HELP[route];
  return help ? <EntryTip entry={help} name={name} align={align} /> : null;
}

/** The same ⓘ beside an insight card's title: the key into CARD_HELP. */
export function CardHelp({ card, align }: { card: string; align?: Align }) {
  const help = CARD_HELP[card];
  return help ? <EntryTip entry={help} align={align} /> : null;
}
