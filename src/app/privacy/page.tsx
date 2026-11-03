import { textPage } from "@/components/text-page";

const page = textPage("/privacy", "privacy.title", "privacy.body");
export const generateMetadata = page.generateMetadata;
export default page.Page;
