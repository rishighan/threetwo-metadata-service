"use strict";

import {
	rankGCDSeries,
	scoreGCDMatches,
	calculateNameScore,
	calculateIssueNumberScore,
	calculateYearScore,
	RankedGCDSeries,
} from "../../../utils/gcd-scorer.utils";
import {
	GCDSeries,
	GCDIssue,
	GCDScorerConfig,
	IssueMatchCandidate,
} from "../../../types/gcd.types";

/* eslint-disable camelcase */

describe("GCD Scorer Utilities", () => {
	// ============================================
	// Helper Functions
	// ============================================

	const createMockSeries = (
		id: number,
		name: string,
		yearBegan: number | null = null,
		publisherName: string = "DC Comics"
	): GCDSeries => ({
		id,
		name,
		sort_name: name,
		year_began: yearBegan,
		year_ended: null,
		issue_count: 10,
		publisher_id: 1,
		publisher: {
			id: 1,
			name: publisherName,
			country_id: 225,
			year_began: 1934,
			year_ended: null,
			url: null,
		},
		notes: null,
		publishing_format: "standard format",
	});

	const createMockIssue = (
		id: number,
		issueNumber: string,
		seriesId: number,
		keyDate: string | null = null
	): GCDIssue => ({
		id,
		issueNumber,
		series_id: seriesId,
		publication_date: null,
		key_date: keyDate,
		price: "$2.99",
		page_count: 32,
		barcode: null,
		isbn: null,
		variant_of_id: null,
		variant_name: null,
		notes: null,
	});

	// ============================================
	// calculateNameScore Tests
	// ============================================
	describe("calculateNameScore", () => {
		it("should return 100 for exact match", () => {
			expect(calculateNameScore("Batman", "Batman")).toBe(100);
		});

		it("should return 100 for case-insensitive exact match", () => {
			expect(calculateNameScore("BATMAN", "batman")).toBe(100);
		});

		it("should return high score for substring match", () => {
			const score = calculateNameScore("Batman: The Dark Knight", "Batman");
			expect(score).toBeGreaterThan(80);
		});

		it("should return moderate score for partial match", () => {
			const score = calculateNameScore("Batman", "Bat");
			expect(score).toBeGreaterThan(50);
			expect(score).toBeLessThan(100);
		});

		it("should return low score for different strings", () => {
			const score = calculateNameScore("Superman", "Batman");
			expect(score).toBeLessThan(50);
		});

		it("should handle empty strings", () => {
			expect(calculateNameScore("", "Batman")).toBe(0);
			expect(calculateNameScore("Batman", "")).toBe(0);
		});

		it("should handle whitespace", () => {
			expect(calculateNameScore("  Batman  ", "Batman")).toBe(100);
		});
	});

	// ============================================
	// calculateIssueNumberScore Tests
	// ============================================
	describe("calculateIssueNumberScore", () => {
		it("should return 100 for exact match", () => {
			expect(calculateIssueNumberScore("1", "1")).toBe(100);
		});

		it("should return 100 for match with leading zeros", () => {
			expect(calculateIssueNumberScore("001", "1")).toBe(100);
			expect(calculateIssueNumberScore("1", "001")).toBe(100);
		});

		it("should return 100 for match with hash prefix", () => {
			expect(calculateIssueNumberScore("#1", "1")).toBe(100);
		});

		it("should return 0 for different numbers", () => {
			expect(calculateIssueNumberScore("1", "2")).toBe(0);
		});

		it("should handle alphanumeric issue numbers", () => {
			expect(calculateIssueNumberScore("1A", "1a")).toBe(100);
		});

		it("should return 0 when either is empty", () => {
			expect(calculateIssueNumberScore("", "1")).toBe(0);
			expect(calculateIssueNumberScore("1", "")).toBe(0);
		});

		it("should handle 'Annual' and special issues", () => {
			expect(calculateIssueNumberScore("Annual 1", "Annual 1")).toBe(100);
		});
	});

	// ============================================
	// calculateYearScore Tests
	// ============================================
	describe("calculateYearScore", () => {
		it("should return 100 for exact match", () => {
			expect(calculateYearScore("2024", "2024")).toBe(100);
		});

		it("should return 100 for numeric string match", () => {
			expect(calculateYearScore("2024", "2024")).toBe(100);
		});

		it("should return 80 for 1 year difference", () => {
			expect(calculateYearScore("2024", "2023")).toBe(80);
			expect(calculateYearScore("2024", "2025")).toBe(80);
		});

		it("should return 60 for 2 years difference", () => {
			expect(calculateYearScore("2024", "2022")).toBe(60);
		});

		it("should return 0 for large year difference", () => {
			expect(calculateYearScore("2024", "2000")).toBe(0);
		});

		it("should return 0 when either year is missing", () => {
			expect(calculateYearScore(null, "2024")).toBe(0);
			expect(calculateYearScore("2024", undefined)).toBe(0);
		});

		it("should extract year from date string", () => {
			expect(calculateYearScore("2024-01-15", "2024")).toBe(100);
		});
	});

	// ============================================
	// rankGCDSeries Tests
	// ============================================
	describe("rankGCDSeries", () => {
		const mockSeriesList: GCDSeries[] = [
			createMockSeries(1, "Batman", 2016),
			createMockSeries(2, "Batman", 2011),
			createMockSeries(3, "Superman", 2016),
			createMockSeries(4, "Batwoman", 2017),
			createMockSeries(5, "Batman: The Dark Knight", 2011),
		];

		it("should rank exact name matches higher", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankGCDSeries(mockSeriesList, config);

			// Batman series should be ranked higher than Superman
			const batmanIndices = ranked
				.map((s, i) => (s.name === "Batman" ? i : -1))
				.filter((i) => i >= 0);
			const supermanIndex = ranked.findIndex((s) => s.name === "Superman");

			batmanIndices.forEach((batmanIndex) => {
				expect(batmanIndex).toBeLessThan(supermanIndex);
			});
		});

		it("should factor in year when provided", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman", year: "2016" },
			};

			const ranked = rankGCDSeries(mockSeriesList, config);

			// 2016 Batman should be ranked higher than 2011 Batman
			const batman2016Index = ranked.findIndex(
				(s) => s.name === "Batman" && s.year_began === 2016
			);
			const batman2011Index = ranked.findIndex(
				(s) => s.name === "Batman" && s.year_began === 2011
			);
			expect(batman2016Index).toBeLessThan(batman2011Index);
		});

		it("should return empty array for empty input", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankGCDSeries([], config);
			expect(ranked).toHaveLength(0);
		});

		it("should preserve all series in output", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked = rankGCDSeries(mockSeriesList, config);
			expect(ranked).toHaveLength(mockSeriesList.length);
		});

		it("should add rankScore property to ranked series", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const ranked: RankedGCDSeries[] = rankGCDSeries(mockSeriesList, config);

			ranked.forEach((series) => {
				expect(series).toHaveProperty("rankScore");
				expect(typeof series.rankScore).toBe("number");
			});
		});
	});

	// ============================================
	// scoreGCDMatches Tests
	// ============================================
	describe("scoreGCDMatches", () => {
		const batmanSeries = createMockSeries(1, "Batman", 2016);
		const supermanSeries = createMockSeries(2, "Superman", 2016);

		const mockCandidates: IssueMatchCandidate[] = [
			{
				issue: { ...createMockIssue(1, "1", 1, "2016-03-01"), series: batmanSeries },
				series: batmanSeries,
			},
			{
				issue: { ...createMockIssue(2, "2", 1, "2016-04-01"), series: batmanSeries },
				series: batmanSeries,
			},
			{
				issue: { ...createMockIssue(3, "1", 2, "2016-05-01"), series: supermanSeries },
				series: supermanSeries,
			},
		];

		it("should score exact matches higher", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			// Batman #1 should be scored higher than Batman #2 or Superman #1
			expect(scored[0].issue.issueNumber).toBe("1");
			expect(scored[0].series.name).toBe("Batman");
		});

		it("should return scores sorted in descending order", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			for (let i = 1; i < scored.length; i++) {
				expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
			}
		});

		it("should cap scores at 100", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1", year: "2016" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			scored.forEach((match) => {
				expect(match.score).toBeLessThanOrEqual(100);
			});
		});

		it("should include score components", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			scored.forEach((match) => {
				expect(match).toHaveProperty("score");
				expect(match).toHaveProperty("nameMatchScore");
				expect(match).toHaveProperty("issueNumberScore");
				expect(match).toHaveProperty("yearScore");
			});
		});

		it("should handle empty candidates array", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreGCDMatches([], config);
			expect(scored).toHaveLength(0);
		});

		it("should factor in year when provided", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1", year: "2016" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			// Batman #1 from 2016 should score highest
			expect(scored[0].issue.issueNumber).toBe("1");
			expect(scored[0].series.name).toBe("Batman");
			expect(scored[0].yearScore).toBe(100);
		});

		it("should handle missing issue numbers in search", () => {
			const config: GCDScorerConfig = {
				searchParams: { name: "Batman" },
			};

			const scored = scoreGCDMatches(mockCandidates, config);

			// Should still return results
			expect(scored.length).toBeGreaterThan(0);
		});

		it("should score similar series names appropriately", () => {
			const batwomanSeries = createMockSeries(3, "Batwoman", 2017);
			const candidatesWithBatwoman: IssueMatchCandidate[] = [
				{
					issue: { ...createMockIssue(1, "1", 1), series: batmanSeries },
					series: batmanSeries,
				},
				{
					issue: { ...createMockIssue(4, "1", 3), series: batwomanSeries },
					series: batwomanSeries,
				},
			];

			const config: GCDScorerConfig = {
				searchParams: { name: "Batman", issueNumber: "1" },
			};

			const scored = scoreGCDMatches(candidatesWithBatwoman, config);

			// Batman should score higher than Batwoman
			const batmanScore = scored.find((m) => m.series.name === "Batman")!.score;
			const batwomanScore = scored.find((m) => m.series.name === "Batwoman")!.score;
			expect(batmanScore).toBeGreaterThan(batwomanScore);
		});
	});
});

/* eslint-enable camelcase */
