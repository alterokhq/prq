import {expect,test} from "vitest";
import {getVoterId} from "../app/voter";
test("a new browser receives an identity",()=>{const values=new Map<string,string>();const id=getVoterId({getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}});expect(id.length).toBeGreaterThan(0);});
