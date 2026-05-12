/**
 * Metron-Specific Scoring Utilities
 *
 * Adapts the existing ComicVine scoring algorithms for Metron's data structure.
 * Uses Levenshtein distance for string matching.
 */

import {
	MetronSeries,
	MetronIssue,
	MetronIssueDetail,
	MetronScorerConfig,
	ScoredMetronMatch,
} from "../types/metron.types";

// ============================================
// Levenshtein Distance Implementation
// ============================================

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching
 */
export const levenshteinDistance = (str1: string, str2: string): number => {
	const m = str1.length;
	const n = str2.length;

	// Create a 2D array to store the distances
	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	// Initialize base cases
	for (let i = 0; i <= m; i++) {
		dp[i][0] = i;
	}
	for (let j = 0; j <= n; j++) {
		dp[0][j] = j;
	}

	// Fill in the DP table
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (str1[i - 1] === str2[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1];
			} else {
				dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
			}
		}
	}

	return dp[m][n];
};

/**
 * Calculate similarity score between two strings (0 to 1)
 * 1 = exact match, 0 = completely different
 */
export const stringSimilarity = (str1: string, str2: string): number => {
	if (!str1 || !str2) {
		return 0;
	}

	const s1 = str1.toLowerCase().trim();
	const s2 = str2.toLowerCase().trim();

	if (s1 === s2) {
		return 1;
	}

	const maxLen = Math.max(s1.length, s2.length);
	if (maxLen === 0) {
		return 1;
	}

	const distance = levenshteinDistance(s1, s2);
	return 1 - distance / maxLen;
};

// ============================================
// Series Ranking
// ============================================

export interface RankedMetronSeries extends MetronSeries {
	matchScore: number;
	nameMatchScore: number;
	yearMatchScore: number;
}

/**
 * Rank Metron series based on search parameters
 * Adapted from ComicVine's rankVolumes function
 */
export const rankMetronSeries = (
	series: MetronSeries[],
	config: MetronScorerConfig
): RankedMetronSeries[] => {
	const searchName = config.searchParams.name?.toLowerCase().trim() || "";
	const searchYear = config.searchParams.year ? parseInt(config.searchParams.year, 10) : null;

	return series
		.map(s => {
			// Calculate name match score
			const seriesName = s.name?.toLowerCase().trim() || "";
			const sortName = s.sort_name?.toLowerCase().trim() || "";

			// Try both name and sort_name, use the better match
			const nameScore = stringSimilarity(searchName, seriesName);
			const sortNameScore = stringSimilarity(searchName, sortName);
			const nameMatchScore = Math.max(nameScore, sortNameScore);

			// Calculate year match score
			let yearMatchScore = 0;
			if (searchYear && s.year_began) {
				// Exact year match gets 1.0, otherwise decay based on distance
				const yearDiff = Math.abs(searchYear - s.year_began);
				if (yearDiff === 0) {
					yearMatchScore = 1.0;
				} else if (yearDiff <= 1) {
					yearMatchScore = 0.8;
				} else if (yearDiff <= 2) {
					yearMatchScore = 0.6;
				} else if (yearDiff <= 5) {
					yearMatchScore = 0.3;
				} else {
					yearMatchScore = 0;
				}
			} else if (!searchYear) {
				// If no year provided, don't penalize
				yearMatchScore = 0.5;
			}

			// Calculate combined match score
			// Name is weighted more heavily (70%) than year (30%)
			const matchScore = nameMatchScore * 0.7 + yearMatchScore * 0.3;

			return {
				...s,
				matchScore,
				nameMatchScore,
				yearMatchScore,
			};
		})
		.sort((a, b) => b.matchScore - a.matchScore);
};

// ============================================
// Issue Scoring
// ============================================

export interface IssueMatchCandidate {
	issue: MetronIssueDetail;
	series: MetronSeries;
}

/**
 * Normalize issue number for comparison
 * Handles various formats: "1", "#1", "001", "1A", etc.
 */
export const normalizeIssueNumber = (num: string): string => {
	if (!num) {
		return "";
	}

	// Remove common prefixes
	let normalized = num.toLowerCase().trim();
	normalized = normalized.replace(/^#/, "");
	normalized = normalized.replace(/^issue\s*/i, "");
	normalized = normalized.replace(/^no\.?\s*/i, "");

	// Remove leading zeros but preserve "0" itself
	normalized = normalized.replace(/^0+(?=\d)/, "");

	return normalized;
};

/**
 * Extract year from various date formats
 * Handles: "2024-01-15", "January 2024", "2024", etc.
 */
export const extractYearFromDate = (dateStr: string): number => {
	if (!dateStr) {
		return 0;
	}

	// Try ISO format first (YYYY-MM-DD)
	const isoMatch = dateStr.match(/^(\d{4})-/);
	if (isoMatch) {
		return parseInt(isoMatch[1], 10);
	}

	// Try year at end (Month YYYY)
	const endMatch = dateStr.match(/(\d{4})$/);
	if (endMatch) {
		return parseInt(endMatch[1], 10);
	}

	// Try any 4-digit sequence
	const anyMatch = dateStr.match(/(\d{4})/);
	if (anyMatch) {
		return parseInt(anyMatch[1], 10);
	}

	return 0;
};

/**
 * Score Metron issue matches
 * Adapted from ComicVine's matchScorer function
 */
export const scoreMetronMatches = (
	candidates: IssueMatchCandidate[],
	config: MetronScorerConfig
): ScoredMetronMatch[] => {
	const searchName = config.searchParams.name?.toLowerCase().trim() || "";
	const searchNumber = config.searchParams.issueNumber?.trim() || "";
	const searchYear = config.searchParams.year;

	return candidates
		.map(({ issue, series }) => {
			// Score components
			let score = 0;
			let seriesMatchScore = 0;
			let nameMatchScore = 0;

			// 1. Series name match (40% weight)
			const seriesName = series.name?.toLowerCase().trim() || "";
			seriesMatchScore = stringSimilarity(searchName, seriesName);
			score += seriesMatchScore * 40;

			// 2. Issue number match (35% weight)
			if (searchNumber) {
				const issueNum = normalizeIssueNumber(issue.issueNumber);
				const searchNum = normalizeIssueNumber(searchNumber);

				if (issueNum === searchNum) {
					nameMatchScore = 1.0;
					score += 35;
				} else if (issueNum.includes(searchNum) || searchNum.includes(issueNum)) {
					nameMatchScore = 0.7;
					score += 24.5;
				} else {
					nameMatchScore = stringSimilarity(issueNum, searchNum);
					score += nameMatchScore * 35;
				}
			} else {
				// No number search, neutral score
				score += 17.5;
				nameMatchScore = 0.5;
			}

			// 3. Year match (15% weight)
			if (searchYear && issue.cover_date) {
				const issueYear = extractYearFromDate(issue.cover_date);
				const searchYearNum = parseInt(searchYear, 10);

				if (issueYear === searchYearNum) {
					score += 15;
				} else if (Math.abs(issueYear - searchYearNum) <= 1) {
					score += 10;
				} else if (Math.abs(issueYear - searchYearNum) <= 2) {
					score += 5;
				}
			} else if (!searchYear) {
				score += 7.5; // Neutral if no year provided
			}

			// 4. Publisher and metadata bonuses (10% weight)
			// Bonus for having complete metadata
			if (issue.title) {
				score += 2;
			}
			if (issue.desc) {
				score += 2;
			}
			if (issue.credits && issue.credits.length > 0) {
				score += 2;
			}
			if (issue.characters && issue.characters.length > 0) {
				score += 2;
			}
			if (issue.image) {
				score += 2;
			}

			return {
				issue,
				series,
				score: Math.min(100, score), // Cap at 100
				nameMatchScore,
				seriesMatchScore,
			};
		})
		.sort((a, b) => b.score - a.score);
};

// ============================================
// Helper Functions
// ============================================

/**
 * Filter and deduplicate issues by ID
 */
export const deduplicateIssues = (issues: MetronIssue[]): MetronIssue[] => {
	const seen = new Set<number>();
	return issues.filter(issue => {
		if (seen.has(issue.id)) {
			return false;
		}
		seen.add(issue.id);
		return true;
	});
};

/**
 * Calculate a quick relevance score for filtering
 * Used to quickly filter out obviously irrelevant matches
 */
export const quickRelevanceCheck = (series: MetronSeries, searchName: string): boolean => {
	const minSimilarity = 0.3; // Minimum threshold to consider

	const seriesName = series.name?.toLowerCase().trim() || "";
	const sortName = series.sort_name?.toLowerCase().trim() || "";
	const search = searchName.toLowerCase().trim();

	// Quick check: does the search term appear in the name?
	if (seriesName.includes(search) || search.includes(seriesName)) {
		return true;
	}

	if (sortName.includes(search) || search.includes(sortName)) {
		return true;
	}

	// Fall back to similarity check
	const similarity = Math.max(
		stringSimilarity(search, seriesName),
		stringSimilarity(search, sortName)
	);

	return similarity >= minSimilarity;
};
