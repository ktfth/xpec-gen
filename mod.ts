import { parseArgs } from "jsr:@std/cli@^1.0.0/parse-args";
import { load } from "jsr:@std/dotenv@^0.225.0";
import { green, red, yellow, bold, cyan, gray, magenta } from "jsr:@std/fmt@^1.0.0/colors";

await load({ export: true });

let API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const MODEL = Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.0-flash-exp:free";

// --- INTERFACE LLM ---
async function queryOpenRouter(messages: any[], temperature: number = 0.7, retries = 5) {
  if (!API_KEY) throw new Error("API Key não definida.");
  const url = "https://openrouter.ai/api/v1/chat/completions";
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://xpecgen.local",
        },
        body: JSON.stringify({ model: MODEL, messages, temperature }),
      });

      if (response.status === 429) {
        const waitTime = 2000 * attempt;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      return data.choices[0]?.message?.content || "";
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return "";
}

// --- AGENTES ---

// 1. O Arquiteto: Cria baseada na Spec funcional
async function architectAgent(prompt: string, spec: string): Promise<string> {
  console.log(cyan("🏗️  O Arquiteto está construindo (Baseado na Spec)..."));
  const systemMsg = `
  CONTEXT / SPECIFICATION:
  ${spec}
  TASK: Implement the user request: "${prompt}".
  OUTPUT: Return ONLY the code/text content.
  `;
  return await queryOpenRouter([{ role: "user", content: systemMsg }], 0.7);
}

// 2. O Auditor: Garante que a Spec funcional foi cumprida
async function auditorAgent(code: string, spec: string): Promise<string> {
  console.log(yellow("🛡️  O Auditor está validando (Compliance da Spec)..."));
  const systemMsg = `
  SPECIFICATION:
  ${spec}
  TASK: Fix any violations of the SPEC in the provided CODE.
  OUTPUT: Return the FIXED code ONLY.
  CODE:
  ${code}
  `;
  return await queryOpenRouter([{ role: "user", content: systemMsg }], 0.2);
}

// 3. O Revisor: Aplica regras de Code Review (Estilo, Limpeza, Patterns)
async function reviewerAgent(code: string, reviewRules: string): Promise<string> {
  console.log(magenta("🧐 O Revisor está polindo (Regras de Review)..."));
  const systemMsg = `
  CODE REVIEW RULES (STYLE GUIDE):
  ${reviewRules}

  ROLE: You are a Senior Code Reviewer.
  TASK: Refactor the provided CODE to strictly follow the REVIEW RULES.
  
  ACTIONS:
  - Fix naming conventions.
  - Optimize imports.
  - Improve comments/docs if requested.
  - Do NOT change the business logic, only the style/structure.

  OUTPUT: Return the REFACTORED code ONLY.
  CODE:
  ${code}
  `;
  return await queryOpenRouter([{ role: "user", content: systemMsg }], 0.2);
}

// --- MAIN FLOW ---

async function main() {
  if (!API_KEY) {
    API_KEY = prompt(bold("🔑 Cole sua OPENROUTER_API_KEY:")) || "";
    if (!API_KEY) Deno.exit(1);
  }

  const args = parseArgs(Deno.args, {
    string: ["spec", "out", "review"],
    alias: { s: "spec", o: "out", r: "review" },
  });

  const userPrompt = args._.join(" ");
  const specPath = args.spec;
  const reviewPath = args.review; // Nova flag
  const outPath = args.out || "output.ts";

  if (!userPrompt || !specPath) {
    console.log(bold("⚡ XpecGen - Pipeline de Geração"));
    console.log(gray("Uso: deno run -A mod.ts --spec <arquivo> [--review <regras>] <prompt>"));
    Deno.exit(0);
  }

  try {
    // 1. Carregar Contextos
    const specContent = await Deno.readTextFile(specPath);
    console.log(green(`📄 Spec Funcional carregada.`));

    let reviewContent = "";
    if (reviewPath) {
        reviewContent = await Deno.readTextFile(reviewPath);
        console.log(green(`📘 Regras de Review carregadas.`));
    }

    // 2. Geração (Arquiteto)
    let code = await architectAgent(userPrompt, specContent);
    code = cleanCode(code);

    // 3. Validação Funcional (Auditor)
    code = await auditorAgent(code, specContent);
    code = cleanCode(code);

    // 4. Code Review (Revisor) - Se houver regras
    if (reviewContent) {
        code = await reviewerAgent(code, reviewContent);
        code = cleanCode(code);
    }

    // 5. Output
    await Deno.writeTextFile(outPath, code);
    console.log(green(`\n✅ Pipeline concluído! Arquivo gerado: ${outPath}`));

  } catch (err) {
    console.error(red(`Erro: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function cleanCode(str: string) {
    return str.replace(/```[\w]*\n/g, "").replace(/```/g, "").trim();
}

if (import.meta.main) main();
