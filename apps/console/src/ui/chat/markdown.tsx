import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in agent text is never rendered (no rehype-raw): it is dropped. Images are not shown
// either, so a reply cannot make the page fetch anything. Links open in a new tab.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: () => null,
};

export function ChatMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
