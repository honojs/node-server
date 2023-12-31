import { getFilePath } from 'hono/utils/filepath'

/**
 * wrapper for getFilePath, with absolute root path
 */
export function getFilePathforAbsRoot(options: {
  root: string
  filename: string
  defaultDocument?: string
}) {
  if (!options.root.startsWith('/')) {
    throw new Error('root must be absolute path')
  }

  const path = getFilePath({
    filename: options.filename,
    defaultDocument: options.defaultDocument,
  })
  if (!path) return undefined

  const root = options.root + (options.root?.endsWith('/') ? '' : '/')
  return root + path
}
