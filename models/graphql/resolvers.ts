/**
 * GraphQL Resolvers for ThreeTwo Metadata Service
 * Maps GraphQL queries to Moleculer service actions
 */

export const resolvers = {
	Query: {
		/**
		 * Search ComicVine for volumes, issues, characters, etc.
		 */
		searchComicVine: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			return broker.call("comicvine.search", {
				query: input.query,
				resources: input.resources,
				format: input.format || "json",
				sort: input.sort,
				// eslint-disable-next-line camelcase
				field_list: input.fieldList,
				limit: input.limit?.toString(),
				offset: input.offset?.toString(),
			});
		},

		/**
		 * Advanced volume-based search with scoring and filtering
		 */
		volumeBasedSearch: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			const result = await broker.call("comicvine.volumeBasedSearch", {
				query: input.query,
				resources: input.resources,
				format: input.format || "json",
				limit: input.limit,
				offset: input.offset,
				fieldList: input.fieldList,
				scorerConfiguration: input.scorerConfiguration,
				rawFileDetails: input.rawFileDetails,
			});

			// Transform the result to match GraphQL schema
			return {
				results: result.results || result,
				totalResults: result.totalResults || result.length || 0,
			};
		},

		/**
		 * Get volume details by URI
		 */
		getVolume: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			return broker.call("comicvine.getVolumes", {
				volumeURI: input.volumeURI,
				fieldList: input.fieldList,
			});
		},

		/**
		 * Get all issues for a series by comic object ID
		 */
		getIssuesForSeries: async (_: any, { comicObjectId }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			return broker.call("comicvine.getIssuesForSeries", {
				comicObjectId,
			});
		},

		/**
		 * Get generic ComicVine resource (issues, volumes, etc.)
		 */
		getComicVineResource: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			return broker.call("comicvine.getResource", {
				resources: input.resources,
				filter: input.filter,
				fieldList: input.fieldList,
			});
		},

		/**
		 * Get story arcs for a volume
		 */
		getStoryArcs: async (_: any, { volumeId }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			return broker.call("comicvine.getStoryArcs", {
				volumeId,
			});
		},

		/**
		 * Get weekly pull list from League of Comic Geeks
		 */
		getWeeklyPullList: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			const locgResponse = await broker.call("comicvine.getWeeklyPullList", {
				startDate: input.startDate,
				currentPage: input.currentPage.toString(),
				pageSize: input.pageSize.toString(),
			});

			// Transform LOCG response to match GraphQL schema
			return {
				result: locgResponse.result.map((item: any) => ({
					name: item.issueName,
					publisher: item.publisher,
					url: item.issueUrl,
					cover: item.coverImageUrl,
					description: item.description || null,
					price: item.price || null,
					rating: item.rating || null,
					pulls: item.pulls || null,
					potw: item.potw || null,
					publicationDate: item.publicationDate || null,
				})),
				meta: locgResponse.meta,
			};
		},

		/**
		 * Fetch resource from Metron API
		 */
		fetchMetronResource: async (_: any, { input }: any, context: any) => {
			const { broker } = context;

			if (!broker) {
				throw new Error("Broker not available in context");
			}

			const result = await broker.call("metron.fetchResource", {
				resource: input.resource,
				method: input.method,
				query: input.query,
			});

			return {
				data: result,
				status: 200,
			};
		},
	},

	Mutation: {
		/**
		 * Placeholder for future mutations
		 */
		_empty: (): null => null,
	},

	// Custom scalar resolver for JSON
	JSON: {
		__parseValue: (value: any): any => value,
		__serialize: (value: any): any => value,
		__parseLiteral: (ast: any): any => ast.value,
	},
};
