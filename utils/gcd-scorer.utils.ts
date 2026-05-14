/**
 * GCD Scorer Utilities
 *
 * Functions for ranking GCD series and scoring issue matches.
 * Used by the volumeBasedSearch action to find the best matches.
 */

import {
	GCDSeries,
	GCDScorerConfig,
	ScoredGCDMatch,
	IssueMatchCandidate,
} from "../types/gcd.types";

// ============================================
// Score Weights
// ============================================

const WEIGHTS = {
	NAME_EXACT: 50,
	NAME_STARTS_WITH: 40,
	NAME_CONTAINS: 25,
	YEAR_EXACT: 30,
	YEAR_CLOSE_1: 20,
	YEAR_CLOSE_3: 10,
	ISSUE_COUNT_MAX: 10,
	PUBLISHER_PRESENT: 10,
	ISSUE_NUMBER_EXACT: 40,
	ISSUE_NUMBER_NORMALIZED: 30,
};

// ============================================
// Ranked Series Type
// ============================================

export interface RankedGCDSeries extends GCDSeries {
	rankScore: number;
}

// ============================================
// String Similarity (Levenshtein)
// ============================================

/**
 * Calculate Levenshtein distance between two strings
 */
export const levenshteinDistance = (str1: string, str2: string): number => {
	const m = str1.length;
	const n = str2.length;

	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 0; i <= m; i++) {
		dp[i][0] = i;
	}
	for (let j = 0; j <= n; j++) {
		dp[0][j] = j;
	}

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
// Series Ranking Functions
// ============================================

/**
 * Calculate a score for a single series based on search parameters.
 */
const calculateSeriesScore = (
	series: GCDSeries,
	searchName: string,
	searchYear: number | null
): number => {
	let score = 0;

	// Name matching (0-50 points)
	const seriesName = series.name.toLowerCase().trim();

	if (seriesName === searchName) {
		score += WEIGHTS.NAME_EXACT;
	} else if (seriesName.startsWith(searchName)) {
		score += WEIGHTS.NAME_STARTS_WITH;
	} else if (seriesName.includes(searchName)) {
		score += WEIGHTS.NAME_CONTAINS;
	}

	// Year matching (0-30 points)
	if (searchYear && series.year_began) {
		const yearDiff = Math.abs(series.year_began - searchYear);
		if (yearDiff === 0) {
			score += WEIGHTS.YEAR_EXACT;
		} else if (yearDiff <= 1) {
			score += WEIGHTS.YEAR_CLOSE_1;
		} else if (yearDiff <= 3) {
			score += WEIGHTS.YEAR_CLOSE_3;
		}
	}

	// Prefer series with more issues (0-10 points)
	score += Math.min(WEIGHTS.ISSUE_COUNT_MAX, series.issue_count / 10);

	// Prefer series with publisher info (0-10 points)
	if (series.publisher_id) {
		score += WEIGHTS.PUBLISHER_PRESENT;
	}

	return score;
};

/**
 * Rank a list of GCD series by relevance to the search parameters.
 *
 * @param series - Array of GCD series to rank
 * @param config - Scorer configuration with search parameters
 * @returns Sorted array of series with rankScore property (highest first)
 */
export const rankGCDSeries = (
	series: GCDSeries[],
	config: GCDScorerConfig
): RankedGCDSeries[] => {
	const searchName = config.searchParams.name.toLowerCase().trim();
	const searchYear = config.searchParams.year
		? parseInt(config.searchParams.year, 10)
		: null;

	return series
		.map(s => ({
			...s,
			rankScore: calculateSeriesScore(s, searchName, searchYear),
		}))
		.sort((a, b) => b.rankScore - a.rankScore);
};

// ============================================
// Issue Number Helpers
// ============================================

/**
 * Normalize an issue number for comparison.
 * Strips leading zeros and common prefixes.
 */
export const normalizeIssueNumber = (issueNumber: string): string => {
	if (!issueNumber) {
		return "";
	}

	let normalized = issueNumber.trim().toLowerCase();

	// Remove common prefixes
	normalized = normalized.replace(/^(issue|no\.?|#)\s*/i, "");

	// Strip leading zeros for numeric portions
	const numMatch = normalized.match(/^0*(\d+(?:\.\d+)?)/);
	if (numMatch) {
		return numMatch[1];
	}

	return normalized;
};

/**
 * Extract year from a date string.
 */
export const extractYear = (dateStr: string): number => {
	if (!dateStr) {
		return NaN;
	}

	// Try to extract 4-digit year
	const yearMatch = dateStr.match(/(\d{4})/);
	if (yearMatch) {
		return parseInt(yearMatch[1], 10);
	}

	return NaN;
};

// ============================================
// Score Calculation Functions
// ============================================

/**
 * Calculate name match score between series name and search name.
 *
 * @param seriesName - Series name from database
 * @param searchName - User's search name
 * @returns Score (0-50)
 */
export const calculateNameScore = (
	seriesName: string,
	searchName: string
): number => {
	const normalizedSeries = seriesName.toLowerCase().trim();
	const normalizedSearch = searchName.toLowerCase().trim();

	if (normalizedSeries === normalizedSearch) {
		return WEIGHTS.NAME_EXACT;
	}
	if (normalizedSeries.startsWith(normalizedSearch)) {
		return WEIGHTS.NAME_STARTS_WITH;
	}
	if (normalizedSeries.includes(normalizedSearch)) {
		return WEIGHTS.NAME_CONTAINS;
	}

	// Partial match using word overlap
	const seriesWords = normalizedSeries.split(/\s+/);
	const searchWords = normalizedSearch.split(/\s+/);
	const matchingWords = searchWords.filter(word =>
		seriesWords.some(sw => sw.includes(word) || word.includes(sw))
	);

	if (matchingWords.length > 0) {
		return Math.round(
			(matchingWords.length / searchWords.length) * WEIGHTS.NAME_CONTAINS
		);
	}

	return 0;
};

/**
 * Calculate issue number match score.
 *
 * @param issueNumber - Issue number from database
 * @param searchNumber - User's search issue number (or undefined)
 * @returns Score (0-40)
 */
export const calculateIssueNumberScore = (
	issueNumber: string,
	searchNumber?: string
): number => {
	if (!searchNumber) {
		return 0;
	}

	const normalizedIssue = normalizeIssueNumber(issueNumber);
	const normalizedSearch = normalizeIssueNumber(searchNumber);

	if (normalizedIssue === normalizedSearch) {
		return WEIGHTS.ISSUE_NUMBER_EXACT;
	}

	// Try numeric comparison for padded numbers (e.g., "001" vs "1")
	const issueNum = parseFloat(normalizedIssue);
	const searchNum = parseFloat(normalizedSearch);

	if (!isNaN(issueNum) && !isNaN(searchNum) && issueNum === searchNum) {
		return WEIGHTS.ISSUE_NUMBER_NORMALIZED;
	}

	return 0;
};

/**
 * Calculate year match score.
 *
 * @param keyDate - Issue key_date in YYYY-MM-DD format
 * @param searchYear - User's search year (or undefined)
 * @returns Score (0-30)
 */
export const calculateYearScore = (
	keyDate: string | null,
	searchYear?: string
): number => {
	if (!searchYear || !keyDate) {
		return 0;
	}

	const issueYear = extractYear(keyDate);
	const targetYear = parseInt(searchYear, 10);

	if (isNaN(issueYear) || isNaN(targetYear)) {
		return 0;
	}

	const yearDiff = Math.abs(issueYear - targetYear);

	if (yearDiff === 0) {
		return WEIGHTS.YEAR_EXACT;
	}
	if (yearDiff <= 1) {
		return WEIGHTS.YEAR_CLOSE_1;
	}
	if (yearDiff <= 3) {
		return WEIGHTS.YEAR_CLOSE_3;
	}

	return 0;
};

// ============================================
// Issue Match Scoring Functions
// ============================================

/**
 * Score a list of issue candidates against search parameters.
 *
 * @param candidates - Array of issue/series pairs to score
 * @param config - Scorer configuration with search parameters
 * @returns Sorted array of scored matches (highest score first)
 */
export const scoreGCDMatches = (
	candidates: IssueMatchCandidate[],
	config: GCDScorerConfig
	// eslint-disable-next-line arrow-body-style
): ScoredGCDMatch[] => {
	return candidates
		.map(c => {
			const nameMatchScore = calculateNameScore(
				c.series.name,
				config.searchParams.name
			);
			const issueNumberScore = calculateIssueNumberScore(
				c.issue.issueNumber,
				config.searchParams.issueNumber
			);
			const yearScore = calculateYearScore(
				c.issue.key_date,
				config.searchParams.year
			);

			return {
				issue: c.issue,
				series: c.series,
				score: nameMatchScore + issueNumberScore + yearScore,
				nameMatchScore,
				issueNumberScore,
				yearScore,
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
export const deduplicateIssues = (issues: { id: number }[]): { id: number }[] => {
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
 * Quick relevance check for filtering
 */
export const quickRelevanceCheck = (series: GCDSeries, searchName: string): boolean => {
	const minSimilarity = 0.3;

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
