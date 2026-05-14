import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleConversion } from '../_lib/conversion'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleConversion(req, res, 'pdf_to_excel', 'xlsx')
}
