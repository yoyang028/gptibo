package recharge

import (
	"context"
	"slices"
	"strconv"

	"gptibo/storefront/internal/fault"
)

type AgentProfile struct {
	Merchant struct {
		Partner string `json:"partnerId"`
		Status  string `json:"status"`
	} `json:"merchant"`
	Profile struct {
		Redemption bool `json:"customRedemptionEnabled"`
	} `json:"profile"`
	Prices map[string]string `json:"productSupplyPrices"`
	Modes  []string          `json:"collectionModes"`
}

func (c *Client) AuthorizedProduct(ctx context.Context, code string) (int64, error) {
	var profile AgentProfile
	if err := c.Request(ctx, "/agent-profile", nil, "", &profile); err != nil {
		return 0, err
	}
	price, err := strconv.ParseInt(profile.Prices[code], 10, 64)
	if err != nil || price < 0 || profile.Merchant.Partner != c.Partner || profile.Merchant.Status != "active" || !profile.Profile.Redemption || !slices.Contains(profile.Modes, "platform_collect") {
		return 0, fault.New(409, "充值代理或该套餐尚未获得购买与自动充值权限。")
	}
	return price, nil
}
