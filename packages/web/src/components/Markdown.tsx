import { Streamdown } from "streamdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "../lib/math.ts";

export function Markdown({ children }: { readonly children: string }) {
  return (
    <Streamdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {normalizeMath(children)}
    </Streamdown>
  );
}
