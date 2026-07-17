package rtk

import (
	"regexp"
	"strings"
)

var (
	reGitLog     = regexp.MustCompile(`(?m)^[*|/\\ ]*commit [0-9a-f]{7,40}`)
	reGitDiff    = regexp.MustCompile(`(?m)^diff --git `)
	reGitHunk    = regexp.MustCompile(`(?m)^@@ `)
	reGitStatus  = regexp.MustCompile(`(?m)^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:`)
	reBuildOut   = regexp.MustCompile(`(?i)^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)`)
	reTreeGlyph  = regexp.MustCompile(`[├└]──|│  `)
	reLsTotal    = regexp.MustCompile(`(?m)^total \d+$`)
	reLsRow      = regexp.MustCompile(`(?m)^[-dlbcps][rwx-]{9}`)
	rePorcelain  = regexp.MustCompile(`(?m)^[ MADRCU?!][ MADRCU?!] \S`)
)

func AutoDetectFilter(text string) func(string) string {
	limit := 1000
	if len(text) < limit {
		limit = len(text)
	}
	head := text[:limit]

	if reGitLog.MatchString(head) {
		return FilterGitLog
	}
	if reGitDiff.MatchString(head) || reGitHunk.MatchString(head) {
		return FilterGitDiff
	}
	if reGitStatus.MatchString(head) {
		return FilterSmartTruncate // Simple truncate for status (or custom status filter)
	}
	if reBuildOut.MatchString(head) {
		return FilterSmartTruncate
	}

	lines := strings.Split(head, "\n")
	var nonEmpty []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			nonEmpty = append(nonEmpty, l)
		}
	}

	// 1. Grep Check: first 5 non-empty lines look like "file:line:content"
	grepLimit := 5
	if len(nonEmpty) < grepLimit {
		grepLimit = len(nonEmpty)
	}
	isGrep := false
	if grepLimit > 0 {
		grepCount := 0
		for i := 0; i < grepLimit; i++ {
			if isGrepLine(nonEmpty[i]) {
				grepCount++
			}
		}
		if grepCount > 0 {
			isGrep = true
		}
	}
	if isGrep {
		return FilterGrep
	}

	// 2. Find check: >= 3 lines, all path-like
	if len(nonEmpty) >= 3 {
		allPaths := true
		for _, line := range nonEmpty {
			if !isPathLike(line) {
				allPaths = false
				break
			}
		}
		if allPaths {
			return FilterSmartTruncate // Or list/find filter, truncate works well
		}
	}

	// 3. Tree check
	if reTreeGlyph.MatchString(head) {
		return FilterTree
	}

	// 4. Ls check
	if reLsTotal.MatchString(head) || len(reLsRow.FindAllString(head, -1)) >= 3 {
		return FilterLs
	}

	// Fallback logs / long files
	if len(nonEmpty) >= 5 {
		return FilterDedupLog
	}
	if len(strings.Split(text, "\n")) >= 40 {
		return FilterSmartTruncate
	}

	return nil
}

func isGrepLine(line string) bool {
	first := strings.Index(line, ":")
	if first == -1 {
		return false
	}
	second := strings.Index(line[first+1:], ":")
	if second == -1 {
		return false
	}
	lineno := line[first+1 : first+1+second]
	_, err := regexp.Compile(`^\d+$`)
	if err != nil {
		return false
	}
	for _, c := range lineno {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(lineno) > 0
}

func isPathLike(line string) bool {
	t := strings.TrimSpace(line)
	if len(t) == 0 {
		return false
	}
	// Windows drive letter check
	if len(t) >= 3 && t[1] == ':' && (t[2] == '\\' || t[2] == '/') {
		return true
	}
	if strings.Contains(t, ":") {
		return false
	}
	return strings.HasPrefix(t, ".") || strings.HasPrefix(t, "/") || strings.Contains(t, "/")
}
