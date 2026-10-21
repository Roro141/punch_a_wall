export async function startCamera(video: HTMLVideoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
  return stream
}

export function cameraError(err: unknown) {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow it in the address bar and reload.'
  if (name === 'NotFoundError') return 'No camera found.'
  if (name === 'NotReadableError') return 'The camera is busy - is another app using it?'
  return 'Could not start the camera.'
}

/**
 * Maps a normalized landmark to screen pixels, matching how the video is shown:
 * object-fit: cover, mirrored horizontally.
 */
export function toScreen(
  nx: number,
  ny: number,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const vw = video.videoWidth || width
  const vh = video.videoHeight || height
  const scale = Math.max(width / vw, height / vh)
  const offsetX = (width - vw * scale) / 2
  const offsetY = (height - vh * scale) / 2
  return {
    x: (1 - nx) * vw * scale + offsetX,
    y: ny * vh * scale + offsetY,
  }
}
