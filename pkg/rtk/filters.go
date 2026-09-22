package rtk

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Human-readable size converter
func humanSize(bytes int64) string {
	if bytes >= 1048576 {
		return fmt.Sprintf("%.1fM", float64(bytes)/1048576.0)
	}
	if bytes >= 1024 {
		return fmt.Sprintf("%.1fK", float64(bytes)/1024.0)
	}
	return fmt.Sprintf("%dB", bytes)
}

// 1. ls -la compressor
var lsDateRe = regexp.MustCompile(`\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+`)

type lsParsed struct {
	fileType rune
	size     int64
	name     string
}

func parseLsLine(line string) *lsParsed {
	loc := lsDateRe.FindStringIndex(line)
	if loc == nil {
		return nil
	}

	name := line[loc[1]:]
	beforeDate := line[:loc[0]]
	beforeParts := strings.Fields(beforeDate)
	if len(beforeParts) < 4 {
		return nil
	}

	perms := beforeParts[0]
	if len(perms) == 0 {
		return nil
	}
	fileType := rune(perms[0])

	// Find the rightmost parseable integer in beforeParts representing size
	var size int64
	for i := len(beforeParts) - 1; i >= 0; i-- {
		if val, err := strconv.ParseInt(beforeParts[i], 10, 64); err == nil {
			size = val
			break
		}
	}

	return &lsParsed{
		fileType: fileType,
		size:     size,
		name:     name,
	}
}

func FilterLs(input string) string {
	var dirs []string
	var files [][2]string
	byExt := make(map[string]int)

	lines := strings.Split(input, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "total ") || len(line) == 0 {
			continue
		}
		parsed := parseLsLine(line)
		if parsed == nil {
			continue
		}
		if parsed.name == "." || parsed.name == ".." {
			continue
		}

		if parsed.fileType == 'd' {
			dirs = append(dirs, parsed.name)
		} else if parsed.fileType == '-' || parsed.fileType == 'l' {
			ext := filepath.Ext(parsed.name)
			if ext == "" {
				ext = "no ext"
			}
			byExt[ext]++
			files = append(files, [2]string{parsed.name, humanSize(parsed.size)})
		}
	}

	if len(dirs) == 0 && len(files) == 0 {
		return input
	}

	var sb strings.Builder
	for _, d := range dirs {
		sb.WriteString(d + "/\n")
	}
	for _, f := range files {
		sb.WriteString(fmt.Sprintf("%s  %s\n", f[0], f[1]))
	}

	sb.WriteString(fmt.Sprintf("\nSummary: %d files, %d dirs", len(files), len(dirs)))
	if len(byExt) > 0 {
		type extCount struct {
			ext   string
			count int
		}
		var list []extCount
		for e, c := range byExt {
			list = append(list, extCount{e, c})
		}
		sort.Slice(list, func(i, j int) bool {
			return list[i].count > list[j].count
		})

		sb.WriteString(" (")
		limit := 3
		if len(list) < limit {
			limit = len(list)
		}
		var extParts []string
		for i := 0; i < limit; i++ {
			extParts = append(extParts, fmt.Sprintf("%d %s", list[i].count, list[i].ext))
		}
		sb.WriteString(strings.Join(extParts, ", "))
		if len(list) > limit {
			sb.WriteString(fmt.Sprintf(", +%d more", len(list)-limit))
		}
		sb.WriteString(")")
	}

	return sb.String()
}

// 2. tree compressor
func FilterTree(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}

	var filtered []string
	for _, line := range lines {
		// Drop summary lines
		if strings.Contains(line, "director") && strings.Contains(line, "file") {
			continue
		}
		if strings.TrimSpace(line) == "" && len(filtered) == 0 {
			continue
		}
		filtered = append(filtered, line)
	}

	// Drop trailing blanks
	for len(filtered) > 0 && strings.TrimSpace(filtered[len(filtered)-1]) == "" {
		filtered = filtered[:len(filtered)-1]
	}

	// Cap tree depth if overly long (say, 250 lines)
	maxLines := 250
	if len(filtered) > maxLines {
		cut := len(filtered) - maxLines
		return strings.Join(filtered[:maxLines], "\n") + fmt.Sprintf("\n... +%d more lines", cut)
	}

	return strings.Join(filtered, "\n")
}

// 3. git diff compressor
func FilterGitDiff(diff string) string {
	lines := strings.Split(diff, "\n")
	var result []string
	var currentFile string
	var added, removed int
	var inHunk bool
	var hunkShown int
	var hunkSkipped int
	var wasTruncated bool
	maxHunkLines := 10
	maxTotalLines := 300

	for _, line := range lines {
		if strings.HasPrefix(line, "diff --git") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			if currentFile != "" && (added > 0 || removed > 0) {
				result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
			}
			parts := strings.Split(line, " b/")
			if len(parts) > 1 {
				currentFile = strings.Join(parts[1:], " b/")
			} else {
				currentFile = "unknown"
			}
			result = append(result, "\n"+currentFile)
			added = 0
			removed = 0
			inHunk = false
			hunkShown = 0
		} else if strings.HasPrefix(line, "@@") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			inHunk = true
			hunkShown = 0
			result = append(result, "  "+line)
		} else if inHunk {
			if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
				added++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
				removed++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if hunkShown < maxHunkLines && !strings.HasPrefix(line, "\\") {
				if hunkShown > 0 {
					result = append(result, "  "+line)
					hunkShown++
				}
			}
		}

		if len(result) >= maxTotalLines {
			result = append(result, "\n... (more changes truncated)")
			wasTruncated = true
			break
		}
	}

	if hunkSkipped > 0 {
		result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
		wasTruncated = true
	}
	if currentFile != "" && (added > 0 || removed > 0) {
		result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
	}
	if wasTruncated {
		result = append(result, "[full diff: rtk git diff --no-compact]")
	}

	return strings.Join(result, "\n")
}

// 4. Grep output compressor
func FilterGrep(input string) string {
	lines := strings.Split(input, "\n")
	var result []string
	count := 0
	maxLines := 150

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if len(trimmed) == 0 {
			continue
		}
		result = append(result, line)
		count++
		if count >= maxLines {
			result = append(result, fmt.Sprintf("... +%d more grep hits truncated", len(lines)-count))
			break
		}
	}
	return strings.Join(result, "\n")
}

// 5. Git Log compressor
var gitCommitHashRe = regexp.MustCompile(`(?m)^commit ([0-9a-f]{7,40})`)

func FilterGitLog(input string) string {
	// Replaces commit hashes with shorter ones and collapses author/date headers
	lines := strings.Split(input, "\n")
	var result []string
	var author, date string

	for _, line := range lines {
		if m := gitCommitHashRe.FindStringSubmatch(line); m != nil {
			if author != "" || date != "" {
				result = append(result, fmt.Sprintf("  %s %s", author, date))
				author = ""
				date = ""
			}
			shortHash := m[1]
			if len(shortHash) > 8 {
				shortHash = shortHash[:8]
			}
			result = append(result, "commit "+shortHash)
		} else if strings.HasPrefix(line, "Author:") {
			author = strings.TrimSpace(strings.TrimPrefix(line, "Author:"))
		} else if strings.HasPrefix(line, "Date:") {
			date = strings.TrimSpace(strings.TrimPrefix(line, "Date:"))
		} else {
			trimmed := strings.TrimSpace(line)
			if len(trimmed) > 0 {
				result = append(result, "  "+trimmed)
			}
		}
	}
	if author != "" || date != "" {
		result = append(result, fmt.Sprintf("  %s %s", author, date))
	}
	return strings.Join(result, "\n")
}

// 6. Generic Smart Truncator
func FilterSmartTruncate(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) <= 100 {
		return input
	}
	// Keeps first 40 and last 40 lines
	head := lines[:40]
	tail := lines[len(lines)-40:]
	middle := fmt.Sprintf("\n... [%d lines truncated for tokens] ...\n", len(lines)-80)
	return strings.Join(head, "\n") + middle + strings.Join(tail, "\n")
}

// 7. Dedup Logs
func FilterDedupLog(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) < 10 {
		return input
	}
	var result []string
	n := len(lines)
	i := 0
	for i < n {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if len(trimmed) == 0 {
			result = append(result, line)
			i++
			continue
		}
		abstracted := regexp.MustCompile(`\d`).ReplaceAllString(trimmed, "X")
		j := i + 1
		for j < n {
			nextTrimmed := strings.TrimSpace(lines[j])
			if len(nextTrimmed) == 0 {
				break
			}
			nextAbstracted := regexp.MustCompile(`\d`).ReplaceAllString(nextTrimmed, "X")
			if nextAbstracted != abstracted {
				break
			}
			j++
		}
		repeatCount := j - i
		if repeatCount > 3 {
			result = append(result, lines[i])
			result = append(result, lines[i+1])
			result = append(result, fmt.Sprintf("... (repeated %d times)", repeatCount-2))
		} else {
			for k := i; k < j; k++ {
				result = append(result, lines[k])
			}
		}
		i = j
	}
	return strings.Join(result, "\n")
}
