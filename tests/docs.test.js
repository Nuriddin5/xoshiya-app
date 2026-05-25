import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(fileName) {
  return fs.readFileSync(path.join(root, fileName), "utf8");
}

test("required project documentation files exist", () => {
  const requiredFiles = [
    "README.md",
    "LICENSE",
    "PROJECT.md",
    "ARCHITECTURE.md",
    "IMPLEMENTATION_PLAN.md",
    "UI_SCREENS.md",
    "DATA_MODEL.md",
    "OPENAI_AND_PROMPTS.md",
    "WHISPER_WINDOWS_SETUP.md",
    "TESTING_ACCEPTANCE.md",
    "MEMORY.md",
    "PROMPTS.md",
    "PROMPT_EXECUTION_RULES.md",
    "UI_VERIFICATION.md",
  ];

  for (const fileName of requiredFiles) {
    assert.equal(fs.existsSync(path.join(root, fileName)), true, `${fileName} should exist`);
  }
});

test("rubai setup docs describe the converted model and no-whisper settings flow", () => {
  const readme = read("README.md");
  const setup = read("WHISPER_WINDOWS_SETUP.md");
  const testing = read("TESTING_ACCEPTANCE.md");
  const uiVerification = read("UI_VERIFICATION.md");

  assert.match(readme, /No Whisper binary or Whisper model path is needed/);
  assert.match(readme, /RUBAI_PYTHON_PATH/);
  assert.match(readme, /RUBAI_CT2_MODEL_PATH/);
  assert.match(readme, /npm run dist:win/);
  assert.match(readme, /npm run dist:mac/);
  assert.match(setup, /Converted Model Expectations/);
  assert.match(setup, /macOS\/Linux Python: \.venv-rubai\/bin\/python/);
  assert.match(setup, /model\.bin/);
  assert.match(setup, /tokenizer\.json/);
  assert.match(setup, /preprocessor_config\.json/);
  assert.match(testing, /no more than two chunks are `transcribing` at a time/);
  assert.match(uiVerification, /at most two chunks enter `transcribing` at a time/);
  assert.match(uiVerification, /last chunk timing/);
});

test("prompt bank requires verification, failure fixes, and commits", () => {
  const prompts = read("PROMPTS.md");

  assert.match(prompts, /PROMPT_EXECUTION_RULES\.md/);
  assert.match(prompts, /UI_VERIFICATION\.md/);
  assert.match(prompts, /full available verification suite/);
  assert.match(prompts, /reports\/YYYY-MM-DD_HH-mm_prompt-XX\.md/);
  assert.match(prompts, /fix any failing test, typecheck, lint, or build error in place/);
  assert.match(prompts, /commit only the verified changes/);
});

test("execution rules protect local-first and git hygiene constraints", () => {
  const rules = read("PROMPT_EXECUTION_RULES.md");
  const uiVerification = read("UI_VERIFICATION.md");
  const gitignore = read(".gitignore");

  assert.match(rules, /Do not send raw audio to OpenAI/);
  assert.match(rules, /OpenAI SDK calls in the Electron main process/);
  assert.match(rules, /Prompt Report Is Mandatory/);
  assert.match(rules, /Do not commit if verification failed/);
  assert.match(uiVerification, /Manual UI Check/);
  assert.match(uiVerification, /Recommended Larger-Model Prompt/);
  assert.match(gitignore, /node_modules\//);
});
