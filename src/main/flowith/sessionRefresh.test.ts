import { describe, expect, it, vi } from "vitest";

type RefreshSessionArgs = { refresh_token: string };
type MockSupabaseSession = { access_token?: string; refresh_token?: string };
type RefreshSessionResponse = { data: { session: MockSupabaseSession } | null; error: Error | null };

async function loadModule(mocks: {
  refreshSession: (args: RefreshSessionArgs) => Promise<RefreshSessionResponse>;
  getRefreshToken: (accountId: string) => string | null;
  setRefreshToken: (accountId: string, refreshToken: string) => unknown;
}) {
  vi.resetModules();
  vi.doMock("./supabase", () => ({
    getFlowithSupabaseClient: () => ({
      auth: { refreshSession: mocks.refreshSession },
    }),
  }));
  vi.doMock("../accounts/vault", () => ({
    getRefreshToken: mocks.getRefreshToken,
    setRefreshToken: mocks.setRefreshToken,
  }));

  return await import("./sessionRefresh");
}

describe("refreshFlowithSessionForAccount", () => {
  it("dedupes concurrent refreshSession calls per account", async () => {
    const refreshSession = vi.fn<(args: RefreshSessionArgs) => Promise<RefreshSessionResponse>>();
    const getRefreshToken = vi.fn<(accountId: string) => string | null>(() => "rt_old");
    const setRefreshToken = vi.fn<(accountId: string, refreshToken: string) => unknown>();

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    refreshSession.mockImplementation(async (_args) => {
      void _args;
      await gate;
      return {
        data: { session: { access_token: "at", refresh_token: "rt_new" } },
        error: null,
      };
    });

    const { refreshFlowithSessionForAccount } = await loadModule({ refreshSession, getRefreshToken, setRefreshToken });

    const p1 = refreshFlowithSessionForAccount("acc1");
    const p2 = refreshFlowithSessionForAccount("acc1");
    if (release) release();

    const [s1, s2] = await Promise.all([p1, p2]);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(setRefreshToken).toHaveBeenCalledWith("acc1", "rt_new");
    expect(s1).toBe(s2);
  });

  it("retries once when refresh token was already used but a newer token exists", async () => {
    const refreshSession = vi.fn<(args: RefreshSessionArgs) => Promise<RefreshSessionResponse>>();
    const getRefreshToken = vi.fn<(accountId: string) => string | null>();
    const setRefreshToken = vi.fn<(accountId: string, refreshToken: string) => unknown>();

    getRefreshToken.mockImplementationOnce(() => "rt_old").mockImplementationOnce(() => "rt_new");

    refreshSession.mockImplementation(async (args) => {
      if (args.refresh_token === "rt_old") {
        return {
          data: null,
          error: new Error("Invalid Refresh Token: Already Used"),
        };
      }
      return {
        data: { session: { access_token: "at", refresh_token: "rt_new2" } },
        error: null,
      };
    });

    const { refreshFlowithSessionForAccount } = await loadModule({ refreshSession, getRefreshToken, setRefreshToken });

    const session = await refreshFlowithSessionForAccount("acc1");
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(setRefreshToken).toHaveBeenCalledWith("acc1", "rt_new2");
    expect(session.access_token).toBe("at");
  });

  it("invokes onAlreadyUsed to allow recovery when vault token is stale", async () => {
    const refreshSession = vi.fn<(args: RefreshSessionArgs) => Promise<RefreshSessionResponse>>();
    let currentToken = "rt_old";
    const getRefreshToken = vi.fn<(accountId: string) => string | null>((accountId) => {
      void accountId;
      return currentToken;
    });
    const setRefreshToken = vi.fn<(accountId: string, refreshToken: string) => unknown>();

    refreshSession.mockImplementation(async (args) => {
      if (args.refresh_token === "rt_old") {
        return {
          data: null,
          error: new Error("Invalid Refresh Token: Already Used"),
        };
      }
      return {
        data: { session: { access_token: "at", refresh_token: "rt_new2" } },
        error: null,
      };
    });

    const { refreshFlowithSessionForAccount } = await loadModule({ refreshSession, getRefreshToken, setRefreshToken });

    const onAlreadyUsed = vi.fn(async () => {
      currentToken = "rt_new";
    });

    const session = await refreshFlowithSessionForAccount("acc1", { onAlreadyUsed });
    expect(onAlreadyUsed).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(setRefreshToken).toHaveBeenCalledWith("acc1", "rt_new2");
    expect(session.access_token).toBe("at");
  });
});
