"use strict";

import { Errors, ServiceBroker, Context } from "moleculer";
import MetronService from "../../../services/metron.service";

// Mock axios
jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Test 'metron' service", () => {
	const broker = new ServiceBroker({ logger: false });
	broker.createService(MetronService);

	// Store original env vars
	const originalEnv = process.env;

	beforeAll(() => broker.start());
	afterAll(() => broker.stop());

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks();
		// Reset env vars
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	// ============================================
	// Health Check Tests
	// ============================================
	describe("Test 'v1.metron.health' action", () => {
		it("should return unconfigured status when credentials are missing", async () => {
			delete process.env.METRON_USERNAME;
			delete process.env.METRON_PASSWORD;

			const res = await broker.call("v1.metron.health") as any;

			expect(res.status).toBe("unconfigured");
			expect(res.configured).toBe(false);
		});

		it("should return ok status when credentials are set", async () => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";

			const res = await broker.call("v1.metron.health") as any;

			expect(res.status).toBe("ok");
			expect(res.configured).toBe(true);
		});
	});

	// ============================================
	// Configuration Validation Tests
	// ============================================
	describe("Test configuration validation", () => {
		it("should throw error when credentials are missing for searchSeries", async () => {
			delete process.env.METRON_USERNAME;
			delete process.env.METRON_PASSWORD;

			await expect(
				broker.call("v1.metron.searchSeries", { name: "Batman" })
			).rejects.toThrow();
		});

		it("should throw error when credentials are missing for getSeriesById", async () => {
			delete process.env.METRON_USERNAME;
			delete process.env.METRON_PASSWORD;

			await expect(
				broker.call("v1.metron.getSeriesById", { id: 1 })
			).rejects.toThrow();
		});
	});

	// ============================================
	// Search Series Tests
	// ============================================
	describe("Test 'v1.metron.searchSeries' action", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should search series by name", async () => {
			const mockResponse = {
				data: {
					count: 2,
					next: null,
					previous: null,
					results: [
						{
							id: 1,
							name: "Batman",
							sort_name: "Batman",
							volume: 1,
							year_began: 2016,
							year_end: null,
							issue_count: 100,
							publisher: { id: 1, name: "DC Comics" },
							series_type: { id: 1, name: "Ongoing" },
							image: "https://metron.cloud/media/series/batman.jpg",
							modified: "2024-01-01T00:00:00Z",
							resource_url: "https://metron.cloud/series/1/",
						},
						{
							id: 2,
							name: "Batman: The Dark Knight",
							sort_name: "Batman: The Dark Knight",
							volume: 1,
							year_began: 2011,
							year_end: 2014,
							issue_count: 29,
							publisher: { id: 1, name: "DC Comics" },
							series_type: { id: 2, name: "Limited" },
							image: "https://metron.cloud/media/series/dark-knight.jpg",
							modified: "2024-01-01T00:00:00Z",
							resource_url: "https://metron.cloud/series/2/",
						},
					],
				},
				headers: {
					"x-ratelimit-burst-limit": "100",
					"x-ratelimit-burst-remaining": "99",
					"x-ratelimit-burst-reset": "60",
					"x-ratelimit-sustained-limit": "1000",
					"x-ratelimit-sustained-remaining": "999",
					"x-ratelimit-sustained-reset": "3600",
				},
			};

			mockedAxios.get.mockResolvedValueOnce(mockResponse);

			const res = await broker.call("v1.metron.searchSeries", { name: "Batman" }) as any;

			expect(res.count).toBe(2);
			expect(res.results).toHaveLength(2);
			expect(res.results[0].name).toBe("Batman");
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/series/"),
				expect.objectContaining({
					params: { name: "Batman", page: 1 },
				})
			);
		});

		it("should pass pagination parameter", async () => {
			mockedAxios.get.mockResolvedValueOnce({
				data: { count: 0, next: null, previous: null, results: [] },
				headers: {},
			});

			await broker.call("v1.metron.searchSeries", { name: "Batman", page: 2 });

			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					params: { name: "Batman", page: 2 },
				})
			);
		});

		it("should validate required name parameter", async () => {
			await expect(
				broker.call("v1.metron.searchSeries", {})
			).rejects.toThrow();
		});
	});

	// ============================================
	// Get Series By ID Tests
	// ============================================
	describe("Test 'v1.metron.getSeriesById' action", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should get series details by ID", async () => {
			const mockSeriesDetail = {
				id: 1,
				name: "Batman",
				sort_name: "Batman",
				volume: 1,
				year_began: 2016,
				year_end: null,
				issue_count: 100,
				publisher: { id: 1, name: "DC Comics" },
				series_type: { id: 1, name: "Ongoing" },
				image: "https://metron.cloud/media/series/batman.jpg",
				modified: "2024-01-01T00:00:00Z",
				resource_url: "https://metron.cloud/series/1/",
				desc: "The adventures of Batman",
				genres: [{ id: 1, name: "Superhero" }],
				associated: [],
			};

			mockedAxios.get.mockResolvedValueOnce({
				data: mockSeriesDetail,
				headers: {},
			});

			const res = await broker.call("v1.metron.getSeriesById", { id: 1 }) as any;

			expect(res.id).toBe(1);
			expect(res.name).toBe("Batman");
			expect(res.desc).toBe("The adventures of Batman");
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/series/1/"),
				expect.any(Object)
			);
		});

		it("should validate required id parameter", async () => {
			await expect(
				broker.call("v1.metron.getSeriesById", {})
			).rejects.toThrow();
		});
	});

	// ============================================
	// Search Issues Tests
	// ============================================
	describe("Test 'v1.metron.searchIssues' action", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should search issues by series_id", async () => {
			const mockResponse = {
				data: {
					count: 1,
					next: null,
					previous: null,
					results: [
						{
							id: 101,
							number: "1",
							cover_date: "2024-01-15",
							store_date: "2024-01-17",
							image: "https://metron.cloud/media/issue/cover.jpg",
							cover_hash: "abc123",
							series: { id: 1, name: "Batman" },
							modified: "2024-01-01T00:00:00Z",
							resource_url: "https://metron.cloud/issue/101/",
						},
					],
				},
				headers: {},
			};

			mockedAxios.get.mockResolvedValueOnce(mockResponse);

			const res = await broker.call("v1.metron.searchIssues", {
				series_id: 1,
			}) as any;

			expect(res.count).toBe(1);
			expect(res.results).toHaveLength(1);
		});

		it("should search issues by issue number", async () => {
			mockedAxios.get.mockResolvedValueOnce({
				data: { count: 0, next: null, previous: null, results: [] },
				headers: {},
			});

			await broker.call("v1.metron.searchIssues", {
				series_id: 1,
				issueNumber: "5",
			});

			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					params: expect.objectContaining({
						series_id: 1,
						number: "5",
					}),
				})
			);
		});

		it("should search issues by cover_year", async () => {
			mockedAxios.get.mockResolvedValueOnce({
				data: { count: 0, next: null, previous: null, results: [] },
				headers: {},
			});

			await broker.call("v1.metron.searchIssues", {
				cover_year: 2024,
			});

			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					params: expect.objectContaining({
						cover_year: 2024,
					}),
				})
			);
		});
	});

	// ============================================
	// Get Issue By ID Tests
	// ============================================
	describe("Test 'v1.metron.getIssueById' action", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should get issue details by ID", async () => {
			const mockIssueDetail = {
				id: 101,
				number: "1",
				cover_date: "2024-01-15",
				store_date: "2024-01-17",
				image: "https://metron.cloud/media/issue/cover.jpg",
				cover_hash: "abc123",
				series: { id: 1, name: "Batman" },
				modified: "2024-01-01T00:00:00Z",
				resource_url: "https://metron.cloud/issue/101/",
				title: "The Beginning",
				desc: "Batman begins his adventure",
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
				cv_id: 12345,
				gcd_id: null,
			};

			mockedAxios.get.mockResolvedValueOnce({
				data: mockIssueDetail,
				headers: {},
			});

			const res = await broker.call("v1.metron.getIssueById", { id: 101 }) as any;

			expect(res.id).toBe(101);
			expect(res.issueNumber).toBe("1");
			expect(res.title).toBe("The Beginning");
			expect(res.credits).toHaveLength(1);
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/issue/101/"),
				expect.any(Object)
			);
		});

		it("should map 'number' field to 'issueNumber'", async () => {
			mockedAxios.get.mockResolvedValueOnce({
				data: {
					id: 101,
					number: "42",
					cover_date: "2024-01-15",
					series: { id: 1, name: "Batman" },
				},
				headers: {},
			});

			const res = await broker.call("v1.metron.getIssueById", { id: 101 }) as any;

			expect(res.issueNumber).toBe("42");
		});
	});

	// ============================================
	// Error Handling Tests
	// ============================================
	describe("Test error handling", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should handle 401 authentication error", async () => {
			mockedAxios.get.mockRejectedValueOnce({
				response: {
					status: 401,
					data: { detail: "Authentication credentials were not provided." },
				},
			});

			await expect(
				broker.call("v1.metron.searchSeries", { name: "Batman" })
			).rejects.toMatchObject({
				code: "METRON_AUTH_FAILED",
			});
		});

		it("should handle 404 not found error", async () => {
			mockedAxios.get.mockRejectedValueOnce({
				response: {
					status: 404,
					data: { detail: "Not found." },
				},
			});

			await expect(
				broker.call("v1.metron.getSeriesById", { id: 99999 })
			).rejects.toMatchObject({
				code: "METRON_NOT_FOUND",
			});
		});

		it("should handle 429 rate limit error", async () => {
			mockedAxios.get.mockRejectedValueOnce({
				response: {
					status: 429,
					headers: { "retry-after": "60" },
					data: { detail: "Rate limit exceeded." },
				},
			});

			await expect(
				broker.call("v1.metron.searchSeries", { name: "Batman" })
			).rejects.toMatchObject({
				code: "METRON_RATE_LIMITED",
			});
		});

		it("should handle timeout error", async () => {
			mockedAxios.get.mockRejectedValueOnce({
				code: "ECONNABORTED",
				message: "timeout of 30000ms exceeded",
			});

			await expect(
				broker.call("v1.metron.searchSeries", { name: "Batman" })
			).rejects.toMatchObject({
				code: "METRON_TIMEOUT",
			});
		});

		it("should handle unknown errors", async () => {
			mockedAxios.get.mockRejectedValueOnce({
				message: "Network Error",
			});

			await expect(
				broker.call("v1.metron.searchSeries", { name: "Batman" })
			).rejects.toMatchObject({
				code: "METRON_UNKNOWN_ERROR",
			});
		});
	});

	// ============================================
	// Caching Tests (304 Not Modified)
	// ============================================
	describe("Test conditional request caching", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should use cached data on 304 response", async () => {
			// First request - return data with Last-Modified header
			const mockData = {
				count: 1,
				next: null,
				previous: null,
				results: [{ id: 1, name: "Batman" }],
			};

			mockedAxios.get.mockResolvedValueOnce({
				data: mockData,
				headers: {
					"last-modified": "Wed, 01 Jan 2024 00:00:00 GMT",
				},
			});

			await broker.call("v1.metron.searchSeries", { name: "Batman" });

			// Second request - return 304
			mockedAxios.get.mockRejectedValueOnce({
				response: {
					status: 304,
					data: null,
				},
			});

			// Should return cached data
			const res = await broker.call("v1.metron.searchSeries", { name: "Batman" }) as any;
			expect(res.count).toBe(1);
		});
	});

	// ============================================
	// Match Scores Tests
	// ============================================
	describe("Test 'v1.metron.getMetronMatchScores' action", () => {
		it("should score candidates correctly", async () => {
			const candidates = [
				{
					issue: {
						id: 1,
						issueNumber: "1",
						cover_date: "2024-01-15",
						series: { id: 1, name: "Batman" },
						title: "Test",
						credits: [],
						characters: [],
					},
					series: {
						id: 1,
						name: "Batman",
						year_began: 2024,
						publisher: { id: 1, name: "DC Comics" },
					},
				},
			];

			const scorerConfiguration = {
				searchParams: {
					name: "Batman",
					issueNumber: "1",
				},
			};

			const res = await broker.call("v1.metron.getMetronMatchScores", {
				candidates,
				scorerConfiguration,
			}) as any;

			expect(res).toHaveLength(1);
			expect(res[0]).toHaveProperty("score");
			expect(res[0].score).toBeGreaterThan(0);
		});
	});

	// ============================================
	// Legacy Fetch Resource Tests
	// ============================================
	describe("Test 'v1.metron.fetchResource' action (legacy)", () => {
		beforeEach(() => {
			process.env.METRON_USERNAME = "testuser";
			process.env.METRON_PASSWORD = "testpass";
		});

		it("should fetch arbitrary resource", async () => {
			const mockData = { id: 1, name: "Test Publisher" };

			mockedAxios.get.mockResolvedValueOnce({
				data: mockData,
				headers: {},
			});

			const res = await broker.call("v1.metron.fetchResource", {
				resource: "/publisher/1/",
			});

			expect(res).toEqual(mockData);
		});

		it("should handle resource without leading slash", async () => {
			mockedAxios.get.mockResolvedValueOnce({
				data: {},
				headers: {},
			});

			await broker.call("v1.metron.fetchResource", {
				resource: "publisher/1/",
			});

			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/publisher/1/"),
				expect.any(Object)
			);
		});
	});
});
