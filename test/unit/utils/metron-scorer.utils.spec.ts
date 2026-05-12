"use strict";

import {
	levenshteinDistance,
	stringSimilarity,
	rankMetronSeries,
	scoreMetronMatches,
	normalizeIssueNumber,
	extractYearFromDate,
	deduplicateIssues,
	quickRelevanceCheck,
	IssueMatchCandidate,
} from "../../../utils/metron-scorer.utils";
import {
	MetronSeries,
	MetronIssue,
	MetronIssueDetail,
	MetronScorerConfig,
} from "../../../types/metron.types";

describe("Metron Scorer Utilities", () => {
	// ============================================
	// Levenshtein Distance Tests
	// ============================================
	describe("levenshteinDistance", () => {
		it("should return 0 for identical strings", () => {
			expect(levenshteinDistance("batman", "batman")).toBe(0);
		});

		it("should return the length of the non-empty string when one is empty", () => {
			expect(levenshteinDistance("", "batman")).toBe(6);
			expect(levenshteinDistance("batman", "")).toBe(6);
		});

		it("should return 1 for single character difference", () => {
			expect(levenshteinDistance("batman", "batmen")).toBe(1);
		});

		it("should handle case-sensitive comparison", () => {
			expect(levenshteinDistance("Batman", "batman")).toBe(1);
		});

		it("should calculate distance for completely different strings", () => {
			expect(levenshteinDistance("abc", "xyz")).toBe(3);
		});

		it("should handle transpositions", () => {
			expect(levenshteinDistance("ab", "ba")).toBe(2);
		});
	});

	// ============================================
	// String Similarity Tests
	// ============================================
	describe("stringSimilarity", () => {
		it("should return 1 for identical strings", () => {
			expect(stringSimilarity("Batman", "Batman")).toBe(1);
		});

		it("should return 1 for case-insensitive matches", () => {
			expect(stringSimilarity("BATMAN", "batman")).toBe(1);
		});

		it("should return 0 for empty strings", () => {
			expect(stringSimilarity("", "batman")).toBe(0);
			expect(stringSimilarity("batman", "")).toBe(0);
		});

		it("should handle whitespace trimming", () => {
			expect(stringSimilarity("  batman  ", "batman")).toBe(1);
		});

		it("should return high similarity for similar strings", () => {
			const similarity = stringSimilarity("Batman", "Batmen");
			expect(similarity).toBeGreaterThan(0.8);
			expect(similarity).toBeLessThan(1);
		});

		it("should return low similarity for different strings", () => {
			const similarity = stringSimilarity("Batman", "Superman");
			expect(similarity).toBeLessThan(0.5);
		});
	});

	// ============================================
	// Normalize Issue Number Tests
	// ============================================
	describe("normalizeIssueNumber", () => {
		it("should remove hash prefix", () => {
			expect(normalizeIssueNumber("#1")).toBe("1");
		});

		it("should remove leading zeros", () => {
			expect(normalizeIssueNumber("001")).toBe("1");
			expect(normalizeIssueNumber("0001")).toBe("1");
		});

		it("should preserve zero itself", () => {
			expect(normalizeIssueNumber("0")).toBe("0");
		});

		it("should handle 'issue' prefix", () => {
			expect(normalizeIssueNumber("issue 5")).toBe("5");
			expect(normalizeIssueNumber("Issue5")).toBe("5");
		});

		it("should handle 'no.' prefix", () => {
			expect(normalizeIssueNumber("no. 5")).toBe("5");
			expect(normalizeIssueNumber("No.5")).toBe("5");
		});

		it("should handle alphanumeric issue numbers", () => {
			expect(normalizeIssueNumber("1A")).toBe("1a");
		});

		it("should return empty string for empty input", () => {
			expect(normalizeIssueNumber("")).toBe("");
		});

		it("should lowercase the result", () => {
			expect(normalizeIssueNumber("Annual 1")).toBe("annual 1");
		});
	});

	// ============================================
	// Extract Year From Date Tests
	// ============================================
	describe("extractYearFromDate", () => {
		it("should extract year from ISO format", () => {
			expect(extractYearFromDate("2024-01-15")).toBe(2024);
		});

		it("should extract year from end of string", () => {
			expect(extractYearFromDate("January 2024")).toBe(2024);
		});

		it("should extract year from middle of string", () => {
			expect(extractYearFromDate("Published in 2024 issue")).toBe(2024);
		});

		it("should return 0 for empty string", () => {
			expect(extractYearFromDate("")).toBe(0);
		});

		it("should return 0 for string without year", () => {
			expect(extractYearFromDate("no year here")).toBe(0);
		});

		it("should handle standalone year", () => {
			expect(extractYearFromDate("2023")).toBe(2023);
		});
	});

	// ============================================
	// Rank Metron Series Tests
	// ============================================
	describe("rankMetronSeries", () => {
		const createMockSeries = (id: number, name: string, yearBegan: number): MetronSeries => ({
			id,
			name,
			sort_name: name,
			volume: 1,
			year_began: yearBegan,
			year_end: null,
			issue_count: 10,
			publisher: { id: 1, name: "DC Comics" },
			series_type: { id: 1, name: "Ongoing" },
			image: "https://example.com/image.jpg",
			modified: "2024-01-01T00:00:00Z",
			resource_url: "https://metron.cloud/series/1/",
		});

		const mockSeriesList: MetronSeries[] = [
			createMockSeries(1, "Batman", 2016),
			createMockSeries(2, "Batman", 2011),
			createMockSeries(3, "Superman", 2016),
			createMockSeries(4, "Batwoman", 2017),
		];

		it("should rank exact name matches higher", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankMetronSeries(mockSeriesList, config);

			// Batman series should be ranked higher than Superman
			const batmanIndex = ranked.findIndex(s => s.name === "Batman");
			const supermanIndex = ranked.findIndex(s => s.name === "Superman");
			expect(batmanIndex).toBeLessThan(supermanIndex);
		});

		it("should factor in year when provided", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman", year: "2016" },
			};

			const ranked = rankMetronSeries(mockSeriesList, config);

			// 2016 Batman should be ranked higher than 2011 Batman
			const firstBatman = ranked.find(s => s.name === "Batman");
			expect(firstBatman?.year_began).toBe(2016);
		});

		it("should return empty array for empty input", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankMetronSeries([], config);
			expect(ranked).toHaveLength(0);
		});

		it("should add match scores to results", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankMetronSeries(mockSeriesList, config);

			ranked.forEach(series => {
				expect(series).toHaveProperty("matchScore");
				expect(series).toHaveProperty("nameMatchScore");
				expect(series).toHaveProperty("yearMatchScore");
			});
		});
	});

	// ============================================
	// Score Metron Matches Tests
	// ============================================
	describe("scoreMetronMatches", () => {
		const createMockIssueDetail = (
			id: number,
			issueNumber: string,
			seriesId: number,
			seriesName: string
		): MetronIssueDetail => ({
			id,
			issueNumber,
			cover_date: "2024-01-15",
			store_date: "2024-01-17",
			image: "https://example.com/cover.jpg",
			cover_hash: "abc123",
			series: { id: seriesId, name: seriesName },
			modified: "2024-01-01T00:00:00Z",
			resource_url: `https://metron.cloud/issue/${id}/`,
			title: "Test Issue",
			desc: "Test description",
			upc: "123456789",
			sku: "SKU123",
			isbn: null,
			price: "3.99",
			page_count: 32,
			rating: { id: 1, name: "T" },
			credits: [{ id: 1, creator: "Tom King", role: ["Writer"] }],
			characters: [{ id: 1, name: "Batman" }],
			teams: [],
			arcs: [],
			reprints: [],
			variants: [],
			cv_id: null,
			gcd_id: null,
		});

		const createMockSeries = (id: number, name: string): MetronSeries => ({
			id,
			name,
			sort_name: name,
			volume: 1,
			year_began: 2024,
			year_end: null,
			issue_count: 10,
			publisher: { id: 1, name: "DC Comics" },
			series_type: { id: 1, name: "Ongoing" },
			image: "https://example.com/image.jpg",
			modified: "2024-01-01T00:00:00Z",
			resource_url: `https://metron.cloud/series/${id}/`,
		});

		const mockCandidates: IssueMatchCandidate[] = [
			{
				issue: createMockIssueDetail(1, "1", 1, "Batman"),
				series: createMockSeries(1, "Batman"),
			},
			{
				issue: createMockIssueDetail(2, "2", 1, "Batman"),
				series: createMockSeries(1, "Batman"),
			},
			{
				issue: createMockIssueDetail(3, "1", 2, "Superman"),
				series: createMockSeries(2, "Superman"),
			},
		];

		it("should score exact matches higher", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1" },
			};

			const scored = scoreMetronMatches(mockCandidates, config);

			// Batman #1 should be scored higher than Batman #2 or Superman #1
			expect(scored[0].issue.issueNumber).toBe("1");
			expect(scored[0].series.name).toBe("Batman");
		});

		it("should return scores sorted in descending order", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreMetronMatches(mockCandidates, config);

			for (let i = 1; i < scored.length; i++) {
				expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
			}
		});

		it("should cap scores at 100", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1" },
			};

			const scored = scoreMetronMatches(mockCandidates, config);

			scored.forEach(match => {
				expect(match.score).toBeLessThanOrEqual(100);
			});
		});

		it("should include match score components", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreMetronMatches(mockCandidates, config);

			scored.forEach(match => {
				expect(match).toHaveProperty("score");
				expect(match).toHaveProperty("nameMatchScore");
				expect(match).toHaveProperty("seriesMatchScore");
			});
		});

		it("should handle empty candidates array", () => {
			const config: MetronScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreMetronMatches([], config);
			expect(scored).toHaveLength(0);
		});
	});

	// ============================================
	// Deduplicate Issues Tests
	// ============================================
	describe("deduplicateIssues", () => {
		const createMockIssue = (id: number): MetronIssue => ({
			id,
			issueNumber: "1",
			cover_date: "2024-01-15",
			store_date: null,
			image: "https://example.com/cover.jpg",
			cover_hash: "abc123",
			series: { id: 1, name: "Batman" },
			modified: "2024-01-01T00:00:00Z",
			resource_url: `https://metron.cloud/issue/${id}/`,
		});

		it("should remove duplicate issues by ID", () => {
			const issues = [
				createMockIssue(1),
				createMockIssue(2),
				createMockIssue(1), // Duplicate
				createMockIssue(3),
			];

			const deduplicated = deduplicateIssues(issues);
			expect(deduplicated).toHaveLength(3);
		});

		it("should preserve order of first occurrence", () => {
			const issues = [
				createMockIssue(1),
				createMockIssue(2),
				createMockIssue(1),
			];

			const deduplicated = deduplicateIssues(issues);
			expect(deduplicated[0].id).toBe(1);
			expect(deduplicated[1].id).toBe(2);
		});

		it("should handle empty array", () => {
			const deduplicated = deduplicateIssues([]);
			expect(deduplicated).toHaveLength(0);
		});

		it("should handle array with no duplicates", () => {
			const issues = [
				createMockIssue(1),
				createMockIssue(2),
				createMockIssue(3),
			];

			const deduplicated = deduplicateIssues(issues);
			expect(deduplicated).toHaveLength(3);
		});
	});

	// ============================================
	// Quick Relevance Check Tests
	// ============================================
	describe("quickRelevanceCheck", () => {
		const createMockSeries = (name: string, sortName?: string): MetronSeries => ({
			id: 1,
			name,
			sort_name: sortName || name,
			volume: 1,
			year_began: 2024,
			year_end: null,
			issue_count: 10,
			publisher: { id: 1, name: "DC Comics" },
			series_type: { id: 1, name: "Ongoing" },
			image: "https://example.com/image.jpg",
			modified: "2024-01-01T00:00:00Z",
			resource_url: "https://metron.cloud/series/1/",
		});

		it("should return true for exact match", () => {
			const series = createMockSeries("Batman");
			expect(quickRelevanceCheck(series, "Batman")).toBe(true);
		});

		it("should return true for case-insensitive match", () => {
			const series = createMockSeries("Batman");
			expect(quickRelevanceCheck(series, "BATMAN")).toBe(true);
		});

		it("should return true when search term is contained in name", () => {
			const series = createMockSeries("Batman: The Dark Knight");
			expect(quickRelevanceCheck(series, "Batman")).toBe(true);
		});

		it("should return true when name is contained in search term", () => {
			const series = createMockSeries("Batman");
			expect(quickRelevanceCheck(series, "Batman the Dark Knight")).toBe(true);
		});

		it("should return false for completely unrelated names", () => {
			const series = createMockSeries("Superman");
			expect(quickRelevanceCheck(series, "X-Men")).toBe(false);
		});

		it("should check sort_name as well", () => {
			const series = createMockSeries("The Batman", "Batman, The");
			expect(quickRelevanceCheck(series, "Batman")).toBe(true);
		});
	});
});
