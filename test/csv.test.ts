import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  escapeCsvCell,
  parseCashOutCsv,
  parseSendCsv,
} from "../src/csv.js";
import { TaliseValidationError } from "../src/errors.js";

describe("CSV parsing & formula-injection neutralization", () => {
  it("auto-detects comma, semicolon, and tab delimiters", () => {
    expect(detectDelimiter("name,to,amount_usd\nAda,ada@talise,10")).toBe(",");
    expect(detectDelimiter("name;to;amount_usd\nAda;ada@talise;10")).toBe(";");
    expect(detectDelimiter("name\tto\tamount_usd\nAda\tada@talise\t10")).toBe("\t");
  });

  it("parses headered and headerless send CSVs cleanly", () => {
    const rows = parseSendCsv(
      "name,to,amount_usd,note\nAda Obi,ada@talise,$25.50,\"Sprint, Q4\"\nTunde,tunde.talise.sui,10,Bonus\n",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      line: 2,
      name: "Ada Obi",
      to: "ada@talise",
      amountUsd: 25.5,
      note: "Sprint, Q4",
    });

    const twoCol = parseSendCsv("ada@talise,5\nbob@talise,12.25\n");
    expect(twoCol).toHaveLength(2);
    expect(twoCol[1]!.amountUsd).toBe(12.25);
  });

  it("rejects out-of-range or >2 decimal USD amounts", () => {
    expect(() => parseSendCsv("to,amount_usd\nada@talise,0")).toThrow(TaliseValidationError);
    expect(() => parseSendCsv("to,amount_usd\nada@talise,1000.01")).toThrow(TaliseValidationError);
    expect(() => parseSendCsv("to,amount_usd\nada@talise,1.234")).toThrow(TaliseValidationError);
  });

  it("parses Naira cash-out CSVs and enforces 10-digit account numbers", () => {
    const rows = parseCashOutCsv(
      "name,bank_code,account_number,amount_ngn\nAda,000013,0123456789,25000\n",
    );
    expect(rows[0]!.amountNgn).toBe(25000);
    expect(() =>
      parseCashOutCsv("name,bank_code,account_number,amount_ngn\nAda,000013,12345,25000\n"),
    ).toThrow(TaliseValidationError);
  });

  it("neutralizes spreadsheet formula prefixes on export", () => {
    expect(escapeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(escapeCsvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(escapeCsvCell("@evil")).toBe("'@evil");
    expect(escapeCsvCell("normal, text")).toBe('"normal, text"');
  });
});
