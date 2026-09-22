package analyzers

import (
	"math"
)

func ComputeEntropy(text string) float64 {
	if len(text) == 0 {
		return 0.0
	}

	counts := make(map[rune]int)
	for _, char := range text {
		counts[char]++
	}

	entropy := 0.0
	total := float64(len(text))

	for _, count := range counts {
		p := float64(count) / total
		entropy -= p * math.Log2(p)
	}

	uniqueCount := len(counts)
	if uniqueCount <= 1 {
		return 0.0
	}

	maxEntropy := math.Log2(float64(uniqueCount))
	if maxEntropy == 0 {
		return 0.0
	}

	return entropy / maxEntropy
}
