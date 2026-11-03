import { textPage } from "@/components/text-page";

const page = textPage("/terms", "terms.title", "terms.body");
export const generateMetadata = page.generateMetadata;
export default page.Page;
