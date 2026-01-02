
import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedBoletoInfo } from "../types";

// Always use the process.env.API_KEY directly for initialization as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const extractBoletoInfo = async (text: string): Promise<ExtractedBoletoInfo | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analise o seguinte texto de um boleto ou fatura e extraia as informações principais em formato JSON estruturado. 

      REGRAS CRÍTICAS:
      1. Se houver uma "Linha Digitável", extraia-a como 'barcode'. 
      2. Identifique o valor (amount) como um número decimal.
      3. A data de vencimento (dueDate) deve estar estritamente no formato YYYY-MM-DD. Se encontrar algo como 25/10/2023, converta para 2023-10-25.
      4. Dê um título curto e amigável ao boleto.
      5. Categorize o gasto em uma destas opções: Moradia, Saúde, Educação, Lazer, Serviços, Alimentação, Transporte, Assinaturas, Cartão de Crédito, Impostos, Seguros, Investimentos, Trabalho, Pets ou Outros.

      TEXTO:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            dueDate: { type: Type.STRING },
            barcode: { type: Type.STRING },
            category: { type: Type.STRING }
          },
          required: ["title", "amount", "dueDate", "category"]
        }
      }
    });

    // Directly access the text property as defined in guidelines
    return JSON.parse(response.text.trim());
  } catch (error) {
    console.error("Erro ao processar boleto com Gemini:", error);
    return null;
  }
};
