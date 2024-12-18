import { eq } from "drizzle-orm";
import { z } from "zod";
import { advertisementsTable } from "~/src/drizzle/tables/advertisements";
import { builder } from "~/src/graphql/builder";
import {
	MutationDeleteAdvertisementInput,
	mutationDeleteAdvertisementInputSchema,
} from "~/src/graphql/inputs/MutationDeleteAdvertisementInput";
import { Advertisement } from "~/src/graphql/types/Advertisement/Advertisement";
import { TalawaGraphQLError } from "~/src/utilities/talawaGraphQLError";

const mutationDeleteAdvertisementArgumentsSchema = z.object({
	input: mutationDeleteAdvertisementInputSchema,
});

builder.mutationField("deleteAdvertisement", (t) =>
	t.field({
		args: {
			input: t.arg({
				description: "",
				required: true,
				type: MutationDeleteAdvertisementInput,
			}),
		},
		description: "Mutation field to delete an advertisement.",
		resolve: async (_parent, args, ctx) => {
			if (!ctx.currentClient.isAuthenticated) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthenticated",
					},
					message: "Only authenticated users can perform this action.",
				});
			}

			const {
				data: parsedArgs,
				error,
				success,
			} = mutationDeleteAdvertisementArgumentsSchema.safeParse(args);

			if (!success) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "invalid_arguments",
						issues: error.issues.map((issue) => ({
							argumentPath: issue.path,
							message: issue.message,
						})),
					},
					message: "Invalid arguments provided.",
				});
			}

			const currentUserId = ctx.currentClient.user.id;

			const [currentUser, existingAdvertisement] = await Promise.all([
				ctx.drizzleClient.query.usersTable.findFirst({
					columns: {
						role: true,
					},
					where: (fields, operators) => operators.eq(fields.id, currentUserId),
				}),
				ctx.drizzleClient.query.advertisementsTable.findFirst({
					columns: {},
					with: {
						advertisementAttachmentsWhereAdvertisement: true,
						organization: {
							columns: {},
							with: {
								organizationMembershipsWhereOrganization: {
									columns: {
										role: true,
									},
									where: (fields, operators) =>
										operators.eq(fields.memberId, currentUserId),
								},
							},
						},
					},
					where: (fields, operators) =>
						operators.eq(fields.id, parsedArgs.input.id),
				}),
			]);

			if (currentUser === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthenticated",
					},
					message: "Only authenticated users can perform this action.",
				});
			}

			if (existingAdvertisement === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "arguments_associated_resources_not_found",
						issues: [
							{
								argumentPath: ["input", "id"],
							},
						],
					},
					message: "No associated resources found for the provided arguments.",
				});
			}

			const currentUserOrganizationMembership =
				existingAdvertisement.organization
					.organizationMembershipsWhereOrganization[0];

			if (
				currentUser.role !== "administrator" &&
				(currentUserOrganizationMembership === undefined ||
					currentUserOrganizationMembership.role !== "administrator")
			) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthorized_action_on_arguments_associated_resources",
						issues: [
							{
								argumentPath: ["input", "id"],
							},
						],
					},
					message:
						"You are not authorized to perform this action on the resources associated to the provided arguments.",
				});
			}

			const [deletedAdvertisement] = await ctx.drizzleClient
				.delete(advertisementsTable)
				.where(eq(advertisementsTable.id, parsedArgs.input.id))
				.returning();

			// Deleted advertisement not being returned means that either it was deleted or its `id` column was changed by external entities before this delete operation.
			if (deletedAdvertisement === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unexpected",
					},
					message: "Something went wrong. Please try again.",
				});
			}

			return Object.assign(deletedAdvertisement, {
				attachments:
					existingAdvertisement.advertisementAttachmentsWhereAdvertisement,
			});
		},
		type: Advertisement,
	}),
);
