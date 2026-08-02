import { Router, type Request, type Response } from 'express'
import { removeBg } from '../services/imageService.js'

const router = Router()

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl } = req.body

    if (!imageUrl) {
      res.status(400).json({
        success: false,
        error: 'imageUrl is required',
      })
      return
    }

    console.log(`RemoveBg request received`)

    const result = await removeBg({ imageUrl })

    console.log(`RemoveBg result: success=${result.success}`)

    res.json(result)
  } catch (error) {
    console.error('RemoveBg route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

export default router