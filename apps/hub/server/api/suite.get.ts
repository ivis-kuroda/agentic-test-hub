/**
 * Returns the whole suite plus each file's current hash.
 *
 * The hash map is what lets an edit page open a save dialog already knowing
 * what to send back: fetching an entity and fetching the hash to guard its
 * save are the same read, not two.
 */
export default defineEventHandler(async () => {
  const store = useStore();
  const { suite, problems, files } = await store.load();
  return { suite, problems, files: Object.fromEntries(files) };
});
