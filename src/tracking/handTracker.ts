import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const base = import.meta.env.BASE_URL

export async function createHandTracker() {
  const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })

  try {
    return await HandLandmarker.createFromOptions(vision, options('GPU'))
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err)
    return HandLandmarker.createFromOptions(vision, options('CPU'))
  }
}

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS
