import { getFilePathforAbsRoot } from './getFilePathforAbsRoot'

describe('getFilePathforAbsRoot', () => {
  it('Should return file path correctly', async () => {
    expect(getFilePathforAbsRoot({ filename: 'foo', root: '/bar' })).toBe('/bar/foo/index.html')
    expect(getFilePathforAbsRoot({ filename: 'foo.txt', root: '/bar' })).toBe('/bar/foo.txt')
  })
})
