export function buildPrUrl(repoNameWithOwner: string, prNumber: number): string {
  return `https://github.com/${repoNameWithOwner}/pull/${prNumber}`
}

export function extractPrNumberFromUrl(url: string): number | null {
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}
