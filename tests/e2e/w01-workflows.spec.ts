import { test,expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
import { reportedWorkflow } from "../fixtures/w01-producer";
test("real CLI branching workflow renders bound graph and equivalent list without inferring missing skill",async({page,browser})=>{
 const server=await launch(),other=await browser.newContext();try{
  const f=await reportedWorkflow(server),second=await other.newPage();await pairPage(page,server);await pairPage(second,server);await page.goto(f.url);await second.goto(f.url);
  for(const tab of[page,second]){await expect(tab.getByRole("heading",{name:"Workflows",exact:true})).toBeVisible();await expect(tab.getByRole("heading",{name:"Verify the change",exact:true})).toBeVisible();await expect(tab.getByText(f.verificationReport.eventId,{exact:true})).toBeVisible();await expect(tab.getByText("Skill Unknown",{exact:true}).first()).toBeVisible();await expect(tab.getByRole("link",{name:"Open linked task",exact:true})).toHaveAttribute("href",new RegExp(f.taskId));}
  await page.getByRole("button",{name:"List",exact:true}).click();await expect(page.getByRole("button",{name:"Unreported follow-up · Unknown",exact:true})).toBeVisible();await page.getByRole("button",{name:"Unreported follow-up · Unknown",exact:true}).click();await expect(page.getByText("No node observation received.",{exact:true})).toBeVisible();
  await f.report("workflow.succeeded",{summary:"Synthetic workflow outcome only"});await expect(second.getByText("succeeded · Terminal record",{exact:true}).first()).toBeVisible();await expect(page.getByText("No node observation received.",{exact:true})).toBeVisible();
 }finally{await other.close();await server.stop();}
});
