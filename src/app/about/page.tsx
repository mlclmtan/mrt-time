import { textPage } from "@/components/text-page";

const page = textPage("/about", "about.title", "about.body");
export const generateMetadata = page.generateMetadata;
export default page.Page;
