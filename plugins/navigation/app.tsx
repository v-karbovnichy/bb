import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Rail, RailNewThreadButton } from "./app/Rail.js";
import { TopList } from "./app/TopList.js";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "rail",
    title: "Панель значков",
    description: "Значки у левого края",
    placement: "rail",
    component: Rail,
    headerComponent: RailNewThreadButton,
  });
  app.slots.experimental_sidebarNavigation({
    id: "top-list",
    title: "Верхний список",
    description: "Строки с названиями над списком чатов",
    placement: "list",
    component: TopList,
  });
});
