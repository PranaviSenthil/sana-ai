import * as pdfParseModule from "pdf-parse";
import mammoth from "mammoth";
import { Buffer } from "node:buffer";

// Handle differences between CJS and ESM exports at runtime
const parsePDF = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default || pdfParseModule;

export async function downloadAndParseFile(url: string, kind: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`);
    
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (kind === "pdf") {
      const data = await parsePDF(buffer);
      return data.text;
    } 
    
    if (kind === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (kind === "txt") {
      return buffer.toString("utf-8");
    }

    // Default fallback
    return buffer.toString("utf-8");
  } catch (error) {
    console.error("Error parsing file:", error);
    return "[Error: Could not extract text from this document.]";
  }
}
