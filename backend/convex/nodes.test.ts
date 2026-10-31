import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { newTest, signedInUser } from "./test.helpers";

test("only allowlisted editors can write; anyone can read", async () => {
  const t = newTest();
  await expect(t.mutation(api.nodes.createTopic, { title: "React" })).rejects.toThrow(/Not signed in/);
  const outsider = await signedInUser(t, "eve@example.com");
  await expect(outsider.mutation(api.nodes.createTopic, { title: "React" })).rejects.toThrow(/Not signed in/);

  const bob = await signedInUser(t, "bob@example.com");
  expect(await bob.mutation(api.nodes.createTopic, { title: "React" })).toBe("react");
  const topics = await t.query(api.nodes.topics, {});
  expect(topics.map((x) => x.title)).toEqual(["React"]);
});
