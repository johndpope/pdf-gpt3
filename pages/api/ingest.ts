import type { NextApiRequest, NextApiResponse, PageConfig } from "next"
import { PineconeClient } from "@pinecone-database/pinecone"
import { Document } from "langchain/document"
import { OpenAIEmbeddings } from "langchain/embeddings"
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter"
import { PineconeStore } from "langchain/vectorstores"

import { fileConsumer, formidablePromise } from "@/lib/formidable"
import { getTextContentFromPDF } from "@/lib/pdf"

const PINECONE_INDEX_NAME = "data-gpt"

const formidableConfig = {
  keepExtensions: true,
  maxFileSize: 10_000_000,
  maxFieldsSize: 10_000_000,
  maxFields: 7,
  allowEmptyFiles: false,
  multiples: false,
}

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  const chunks: never[] = []

  const { fields, files } = await formidablePromise(req, {
    ...formidableConfig,
    // consume this, otherwise formidable tries to save the file to disk
    fileWriteStreamHandler: () => fileConsumer(chunks),
  })

  const fileData = Buffer.concat(chunks)
  const openaiApiKey = process.env.OPENAI_API_KEY
  const pineconeApiKey = process.env.PINECONE_API_KEY

  const { file } = files
  let fileText = ""

  switch (file.mimetype) {
    case "text/plain":
      fileText = fileData.toString()
      break
    case "application/pdf":
      fileText = await getTextContentFromPDF(fileData)
      break
    case "application/octet-stream":
      fileText = fileData.toString()
      break
    default:
      throw new Error("Unsupported file type.")
  }

  const rawDocs = new Document({ pageContent: fileText })
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  })
  const docs = await textSplitter.splitDocuments([rawDocs])

  const pinecone = new PineconeClient()

  await pinecone.init({
    environment: "us-east1-gcp",
    apiKey: pineconeApiKey,
  })

  const index = pinecone.Index(PINECONE_INDEX_NAME)
  await PineconeStore.fromDocuments(
    index,
    docs,
    new OpenAIEmbeddings({
      openAIApiKey: openaiApiKey,
    })
  )

  res.status(200).json({})
}

export const config: PageConfig = {
  api: {
    bodyParser: false,
  },
}

export default handler
