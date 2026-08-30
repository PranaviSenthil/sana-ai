import { createGroq } from "@ai-sdk/groq";

export function getGroqModel(modelName = "groq/compound") {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");
  const groq = createGroq({ apiKey });
  return groq(modelName);
}

export function getGroqVisionModel(modelName = "groq/compound") {
  return getGroqModel(modelName);
}

