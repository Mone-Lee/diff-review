/**
 * @Owners lzy
 * @Title 业务商品库详情-SKU设置
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, TableProps, Image, InputNumber, Tooltip, Button, Select, Popconfirm, Form, message, Modal, Table, Input, Flex, Row, Tabs, Radio } from 'antd';
import { ColumnProps, DataItemType } from '../edit';
import { headerKeysEnum, performanceMap, unitTypeConst, WELFARE_GOODS_BIZ_SOURCE_ARR, UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE, ActivityStatusMap } from '../ts';
import { ExclamationCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { uNumber } from 'fq-ecmiddle-sys-web-utils';
import { hPrompt, hRequest, hUser } from 'fq-ecmiddle-sys-front-web/helpers';
import lodash, { debounce } from 'lodash';
import GoodsTagModal from '../../CombinationGoods/components/GoodsTagModal';
import { mathFloor } from '../../CombinationGoods/utils/index';
import { cGoods } from 'fq-ecmiddle-sys-front-web/consts';
import { FQAuthEnums } from 'fq-common-enums';
import SelectPrizeModal, { LuckyCardSelectInfo } from '../@components/SelectPrizeModal';
import DeliveryTimeFrameModal, { WarehouseItem } from './DeliveryTimeFrameModal';
import { getEnergyEfficiencyLevelTitle, getEnergyEfficiencyLogoTitle } from 'fq-ecmiddle-sys-front-web/pages/Home/NationalSubsidyManage/utils';
import { clampMarketingProfitRate } from '../../CombinationGoods/utils';

import { MultiImageUpload } from '../../CombinationGoods/components/MultiImageUpload';
import dayjs from 'dayjs';
import isNil from 'lodash/isNil';

type UnitList = Caibird.dPage.Home.GoodsUnitRespVO;
type SkuUnit = Caibird.dPage.IntegralManage.Response.SkuUnit;
const priceMin = 0;
const priceMax = 99999999999;
// 万能券抵扣配置常量：统一收敛在一个对象里，便于维护和阅读
const UNIVERSAL_CARD_DEDUCT = {
    // 开关：0-不支持，1-支持
    SWITCH: {
        OFF: 0,
        ON: 1,
    },
    // 默认限定张数
    DEFAULT_COUNT: 1,
    // 限定张数最小值
    COUNT_MIN: 1,
} as const;

const communityGroupHeaderKeys = [headerKeysEnum.COMMUNITY_GROUP, headerKeysEnum.WAREHOUSE_TO_STORE] as string[];
const batchHeaderKeys = [headerKeysEnum.BATCH_GOODS, headerKeysEnum.BATCH_STORE_GOODS] as string[];
/**
 * 计算平台运营成本的默认值
 * 计算规则: 平台运营成本 = 会员价 * 5%（默认）
 * 计算规则: 平台运营成本 = 会员价 * 8%（一件代发到店）
 * @param memberPrice 当前规格的会员价
 * @param settlementPrice 当前规格的结算价
 * @param ratio 平台运营成本比例
 */
export const handleCalcPlatformProfit = (params: { memberPrice: number; settlementPrice: number }, ratio?: number) => {
    const { memberPrice = 0, settlementPrice = 0 } = params;
    const _ratio = ratio || 0.05;
    // 整体利润 = 会员价 - 结算价（向下取整保留2位小数）
    const _overallProfit = mathFloor(uNumber.centToYuan(uNumber.yuanToCent(memberPrice) - uNumber.yuanToCent(settlementPrice)), 2);
    // 平台运营成本 = 会员价 * ratio（向下取整保留2位小数）
    const _platformProfit = mathFloor(Number(memberPrice) * _ratio, 2);
    // 取整体利润和平台运营成本的较小値，最小为 0（结算价超出会员价时运营成本为 0）
    return Math.max(0, _overallProfit < _platformProfit ? _overallProfit : _platformProfit);
};

/**
 * 计算总佣金
 * @param param0
 * @returns
 */
export const handleCalcTotalCommission = ({ memberPrice, settlementPrice, platformProfit }: { memberPrice: number; settlementPrice: number; platformProfit: number }) => {
    const _serviceFee = uNumber.toFixed(Number(memberPrice) - Number(settlementPrice) - Number(platformProfit), 2);
    if (_serviceFee < 0) return 0;
    return _serviceFee;
};

/**
 * 团批总佣金
 * 计算规则: 总佣金 = 会员价 * 2%
 * @param index 规格的索引
 * @param memberPrice 当前规格的会员价
 * @param settlementPrice 当前规格的结算价
 */
export const handleCalcGroupBatchTotalCommission = (params: { memberPrice: number; settlementPrice: number }) => {
    const { memberPrice = 0, settlementPrice = 0 } = params;
    // 整体利润 = 会员价 - 结算价（向下取整保留2位小数）
    const _overallProfit = mathFloor(Number(memberPrice) - Number(settlementPrice), 2);
    // 总佣金 = 会员价 * 2%（向下取整保留2位小数）
    const _totalCommission = mathFloor(Number(memberPrice) * 0.02, 2);
    // 取整体利润和平台运营成本的较小値，最小为 0（结算价超出会员价时运营成本为 0）
    return Math.max(0, _overallProfit < _totalCommission ? _overallProfit : _totalCommission);
};

const Index = ({
    headerKey,
    handleUpdateValue,
    handleUpdateTableData,
    edit,
    serviceFeeRate,
    crossMarketingCommissionRate,
    baseCommunityGroupRate,
    productInfo,
    handleResetTableData,
    tableData,
    isView,
    showNationalSubsidyType,
    warehouseList,
    selectedWarehouseIds,
}: ColumnProps) => {
    const [unitList, setUnitList] = useState<UnitList[]>([]);
    const [profitList, setProfitList] = useState<Caibird.dFetch.Api['CommissionRatioManagement']['pageGoodsProfitRate']['rsp']['dataList']>([]);
    const [tagModalVisible, setTagModalVisible] = useState<boolean>(false);
    const [skuIds, setSkuIds] = useState<number[]>([]);
    const [sDataItemType, setDataItemType] = useState<DataItemType>();
    const hasInitializedDefaultRef = useRef(false);
    // 批量设置的数据
    const [bactchModalVisible, setBactchModalVisible] = useState<boolean>(false);
    const [modifyType, setModifyType] = useState<string>('');
    const [modifyValue, setModifyValue] = useState<number | undefined>(undefined);
    // 批量设置会员返积分，模式：rate 按比例，point 按积分
    const [modifyShopCommissionIntegralMode, setModifyShopCommissionIntegralMode] = useState<'point' | 'rate'>('rate');
    // 批量更改【会员返积分占零售价百分比】
    const [modifyShopCommissionIntegralRate, setModifyShopCommissionIntegralRate] = useState<number>(0);
    // 批量更改【会员返积分】
    const [modifyShopCommissionIntegral, setModifyShopCommissionIntegral] = useState<number>(0);
    const [modifySyncPriceSwitch, setModifySyncPriceSwitch] = useState<number>(0); // 会员价零售价同价批量更改配置
    // 批量设置福卡抵扣配置
    const [showBatchLuckyCardModal, setShowBatchLuckyCardModal] = useState<boolean>(false);
    const [batchLuckyCards, setBatchLuckyCards] = useState<LuckyCardSelectInfo[]>([]);
    const [batchLuckyCardMixedDeduction, setBatchLuckyCardMixedDeduction] = useState<number>(0);
    // 批量设置的福卡总数量（混合抵扣模式）
    const [batchTotalFuCardsRequired, setBatchTotalFuCardsRequired] = useState<number>(1);
    // 使用 ref 存储批量设置的最新值，确保在回调中能获取最新值
    const batchLuckyCardsRef = useRef<LuckyCardSelectInfo[]>([]);
    const batchLuckyCardMixedDeductionRef = useRef<number>(0);
    const batchTotalFuCardsRequiredRef = useRef<number>(1);
    // 批量设置时的福卡选择弹窗
    const [showBatchSelectPrizeModal, setShowBatchSelectPrizeModal] = useState<boolean>(false);
    // 监听tableData的变化，如果所有sku的isHide都是0, 则全选状态为true，否则为false
    const allShow = tableData.every(item => item.isHide === 0);

    // 福利商城-选择福卡弹窗
    const [showSelectPrizeModal, setShowSelectPrizeModal] = useState<boolean>(false);
    const [currentSkuIndex, setCurrentSkuIndex] = useState<number>(-1);
    // 福利商城-查看福卡弹窗（只读）
    const [showViewPrizeModal, setShowViewPrizeModal] = useState<boolean>(false);
    const [currentViewSkuIndex, setCurrentViewSkuIndex] = useState<number>(-1);
    // 分仓时效弹窗
    const [deliveryTimeFrameModalVisible, setDeliveryTimeFrameModalVisible] = useState<boolean>(false);
    const [currentDeliveryTimeFrameSkuIndex, setCurrentDeliveryTimeFrameSkuIndex] = useState<number>(-1);
    // 商品支持的发货时效选项（业务商品库使用接口返回数据）
    const [skuDeliveryAgeingInfos, setSkuDeliveryAgeingInfos] = useState<Caibird.dPage.GooDetailManage.SkuDeliveryAgeingInfo[]>([]);
    // 是否福利商城
    const isIntegralGoods = headerKey === headerKeysEnum.INTEGRAL_GOODS;
    // 是否福利商城福卡兑换商品
    const isIntegralCardExchangeGoods = WELFARE_GOODS_BIZ_SOURCE_ARR.includes(headerKey) && productInfo?.exchangeType === cGoods.ExchangeType.LUCKY_CARD_EXCHANGE;
    // 虚拟商品 = 福利商城 + 积分兑换 + 线上充值
    const isBenefitVirtualGoods = headerKey === headerKeysEnum.BENEFIT_GOODS && productInfo?.exchangeType === cGoods.ExchangeType.INTEGRAL_EXCHANGE && productInfo?.performance === cGoods.PerformanceEnum.onlineRecharge;
    /** 是否一件代发到店 */
    const isAnxuanCloudToShop = headerKey === headerKeysEnum.AN_XUAN_CLOUD_TO_SHOP;
    /**
     * 是否价格编辑权限
     * 价格编辑权限判断
     * 先判断按钮权限，如果按钮权限不存在，则判断商品上下架状态
     */
    const hasPriceEditPermission = () => {
        if (hUser.hasPermission(FQAuthEnums['商品管理-价格调整'])) {
            return true;
        }
        // 如果状态是待上架，则返回 true
        return productInfo?.goodsStatus === ActivityStatusMap.UN_SALE;
    };
    const handleAllChange = (checked: boolean) => {
        let newTableData;
        if (!checked) {
            // 全部隐藏，除第一个sku外，其他全部隐藏
            newTableData = tableData.map((item, index) => ({
                ...item,
                isHide: index === 0 ? 0 : 1,
            }));
        } else {
            newTableData = tableData.map(item => ({
                ...item,
                isHide: 0,
            }));
        }
        handleUpdateTableData(newTableData);
    };

    useEffect(() => {
        handleGetGoodsUnitPage();
        handleGetGoodsProfitList();
    }, []);

    // 当profitList加载完成后，为goodsProfitRateCode为空的记录设置默认值
    useEffect(() => {
        if (profitList.length > 0 && tableData.length > 0 && !hasInitializedDefaultRef.current) {
            const defaultCode = profitList[0]?.code; // code 是 string 类型
            if (defaultCode === undefined) return;

            // 检查是否有需要更新的项
            const needUpdate = tableData.some(item => item.goodsProfitRateCode === null || item.goodsProfitRateCode === undefined);

            if (needUpdate) {
                hasInitializedDefaultRef.current = true;
                // 遍历每一项，为空值设置默认值（直接存储string类型）
                tableData.forEach((item, index) => {
                    if (item.goodsProfitRateCode === null || item.goodsProfitRateCode === undefined) {
                        handleUpdateValue(defaultCode, 'goodsProfitRateCode', index);
                    }
                });
            }
        }
    }, [profitList, tableData]);

    // 查询商品支持的发货时效选项
    useEffect(() => {
        if (productInfo?.spuCode) {
            hRequest.api.GoodsDetailManage.querySupportedDeliveryAgeing({
                spuCode: productInfo.spuCode,
                bizSource: productInfo.bizSource,
                supplierId: productInfo.supplierId,
            })
                .then(res => {
                    setSkuDeliveryAgeingInfos(res?.skuDeliveryAgeingInfos || []);
                })
                .catch(() => {
                    setSkuDeliveryAgeingInfos([]);
                });
        } else {
            setSkuDeliveryAgeingInfos([]);
        }
    }, [productInfo?.spuCode, productInfo?.bizSource, productInfo?.supplierId]);

    const showTagModal = (item: DataItemType) => {
        setSkuIds([item.skuId]);
        setTagModalVisible(true);
        setDataItemType(item);
    };

    const handleTagCancel = () => {
        setTagModalVisible(false);
        setDataItemType(undefined);
    };

    const handleGetGoodsUnitPage = (name?: string) => {
        hRequest.api.GoodsUnitManagement.goodsUnitPage({
            page: 1,
            rows: 10,
            condition: {
                name: name || undefined,
            },
        }).then(res => {
            setUnitList(res.dataList);
        });
    };
    const handleGetGoodsProfitList = async (name?: string) => {
        const rsp = await hRequest.api.CommissionRatioManagement.pageGoodsProfitRate({
            page: 1,
            rows: 10,
            condition: {
                status: 1,
                name: name || undefined,
            },
        });
        setProfitList(rsp.dataList);
    };

    const debounceFetcher = debounce((v: string) => {
        handleGetGoodsUnitPage(v);
    }, 300);

    const debounceProfitFetcher = debounce((v: string) => {
        handleGetGoodsProfitList(v);
    }, 300);

    const handleChangeUnitName = (option: UnitList, item: SkuUnit, skuUnitList: SkuUnit[]) => {
        const { id, name } = option;
        item.unitId = id;
        item.unitName = name;

        if (skuUnitList.length > 1) {
            for (let index = 1; index < skuUnitList.length; index++) {
                const current = skuUnitList[index];
                const parant = skuUnitList[index - 1];
                current.parentUnitName = parant.unitName;
                current.parentUnitId = parant.unitId;
            }
        }

        handleResetTableData();
    };

    // 通用的价格计算函数
    const calculatePrices = useCallback(
        (record: DataItemType) => {
            const livePrice = (record.payAmount || 0) * 100; // 直播售价（分）
            const memberDiscount = (record.commissionMoney || 0) * 100; // 直播会员优惠（分）
            const memberPrice = livePrice - memberDiscount; // 直播会员价（分）
            const rate = serviceFeeRate / 100; // 总佣金比例
            const communityMemberPrice = (record.payAmount || 0) * 100 - (record.shopCommissionIntegral || 0) * 100;

            const memberServiceFee = memberPrice * rate; // 会员预估服务费（分）
            const userServiceFee = livePrice * rate; // 用户预估服务费（分）

            // 会员预估利润
            const memberProfit = ((memberPrice - memberServiceFee) * crossMarketingCommissionRate) / 100;
            // 用户预估利润
            const userProfit = ((livePrice - userServiceFee) * crossMarketingCommissionRate) / 100;

            return {
                livePrice, // 直播售价（分）
                memberPrice, // 直播会员价（分）
                memberDiscount, // 直播会员优惠（分）
                rate, // 服务费比例
                memberServiceFee, // 会员预估服务费（分）
                userServiceFee, // 用户预估服务费（分）
                memberSettlementPrice: memberPrice - memberPrice * rate, // 会员预估结算价（分）
                userSettlementPrice: livePrice - livePrice * rate, // 用户预估结算价（分）
                communityMemberPrice, // 社区团购会员价 零售价 - 会员优惠
                memberProfit,
                userProfit,
            };
        },
        [serviceFeeRate, crossMarketingCommissionRate],
    );

    /**
     * sku表格-会员价字段的render处理逻辑
     * @param value 输入框的数值
     * @param record 当前行的数据
     * @param rowIndex 当前行的索引
     * @param fieldKey 针对零售价字段的key
     * @returns React.ReactNode
     */
    const memberPriceFieldRender = (value: number, record: DataItemType, rowIndex: number, fieldKey: 'payAmount' | 'retailPrice') => {
        const { settlementPrice, syncPriceSwitch } = record;
        const hasSettle = settlementPrice !== null && settlementPrice !== undefined;
        const _retailPrice = record[fieldKey];
        const hasValue = value !== undefined && value !== null;
        const invalid = hasValue && hasSettle && value < settlementPrice;
        const isBatch = batchHeaderKeys.includes(headerKey);
        const isBatchNoPermission = isBatch && !hasPriceEditPermission();
        return (
            <div>
                {isBatch ? null : (
                    <p className="flex" style={{ color: '#1677ff', fontSize: '12px' }}>
                        <span style={{ marginRight: '3px' }}>会员价零售价同价</span>
                        <Switch
                            checked={!!syncPriceSwitch}
                            size="small"
                            disabled={!edit}
                            onChange={checked => {
                                if (checked) {
                                    handleUpdateValue(_retailPrice, 'memberPrice', rowIndex);
                                }
                                handleUpdateValue(Number(checked), 'syncPriceSwitch', rowIndex);
                            }}
                        />
                    </p>
                )}
                <InputNumber
                    value={value}
                    min={0}
                    precision={2}
                    disabled={!edit || isBatchNoPermission}
                    style={{ width: '100px' }}
                    placeholder="必填"
                    onBlur={e => {
                        // 修改会员价时，自动计算总佣金和平台运营成本
                        const _memberPrice = Number(e.target.value) || 0;
                        handleUpdateValue(_memberPrice, 'memberPrice', rowIndex);
                        const _settlementPrice = Number(record.settlementPrice) || 0;
                        const _retailPrice = uNumber.toFixed(_memberPrice * 0.2 + _memberPrice, 2);
                        // 团批计算特殊处理
                        if (isBatch) {
                            // 团批场景：总佣金 = 会员价 * 2%，截断保留两位小数 与 会员价 - 结算价 的较小值
                            const _serviceFee = Math.min(mathFloor(_memberPrice * 0.02, 2), _memberPrice - _settlementPrice);
                            // 平台运营成本 = 会员价 - 结算价 - 总佣金
                            const _platformProfit = uNumber.toFixed(_memberPrice - _settlementPrice - _serviceFee, 2);
                            handleUpdateValue(_platformProfit as number, 'platformProfit', rowIndex);
                            handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', rowIndex);
                        } else {
                            const _platformProfit = handleCalcPlatformProfit({
                                memberPrice: _memberPrice,
                                settlementPrice: _settlementPrice,
                            });
                            const _serviceFee = uNumber.toFixed(_memberPrice - _settlementPrice - _platformProfit, 2);
                            // 需要区分总佣金的字段
                            const serviceChargeKey = fieldKey === 'payAmount' ? 'communityGroupCommission' : 'thirdPartyCommission';
                            handleUpdateValue(_platformProfit as number, 'platformProfit', rowIndex);
                            handleUpdateValue(_serviceFee as number, serviceChargeKey, rowIndex);
                            /** 更新总佣金后更新推广服务费(服务商) */
                            const goodsMarketingProfit = mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2);
                            handleUpdateValue(goodsMarketingProfit as number, 'goodsMarketingProfit', rowIndex);
                        }
                        if (syncPriceSwitch) {
                            // 会员价零售价同价开启, 修改会员价，零售价自动填写相同的数值
                            handleUpdateValue(_memberPrice, fieldKey, rowIndex);
                        } else {
                            // 会员价零售价同价关闭，零售价自动在会员价基础上加10%
                            handleUpdateValue(_retailPrice, fieldKey, rowIndex);
                        }
                    }}
                />
                {invalid && edit && (
                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                        不能小于结算价
                    </div>
                )}
            </div>
        );
    };

    /**
     * sku表格-零售价字段的render处理逻辑
     * @param value 输入框的数值
     * @param record 当前行的数据
     * @param rowIndex 当前行的索引
     * @param fieldKey 针对零售价字段的key
     * @returns React.ReactNode
     */
    const retailPriceFieldRender = (value: number, record: DataItemType, rowIndex: number, fieldKey: 'payAmount' | 'retailPrice') => {
        const { memberPrice, syncPriceSwitch } = record;
        const hasMember = memberPrice !== undefined && memberPrice !== null;
        const hasValue = value !== undefined && value !== null;
        const invalidRetail = hasMember && hasValue && Number(value) < Number(memberPrice);
        const isBatch = batchHeaderKeys.includes(headerKey);
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    height: '100%',
                }}
            >
                <InputNumber
                    style={{ width: '92px' }}
                    placeholder="请输入"
                    precision={2}
                    max={priceMax}
                    min={priceMin}
                    disabled={!edit}
                    value={value}
                    onBlur={e => {
                        const _retailPrice = Number(e.target.value) || 0;
                        // 非团批，非一件代发到店场景下，才出现同价按钮，修改零售价时，自动计算会员价
                        if (syncPriceSwitch && !isBatch && !isAnxuanCloudToShop) {
                            handleUpdateValue(_retailPrice, 'memberPrice', rowIndex);
                        }
                        handleUpdateValue(_retailPrice, fieldKey, rowIndex);
                    }}
                />
                {invalidRetail && (
                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                        不能小于会员价
                    </div>
                )}
            </div>
        );
    };

    /**
     * 更新平台运营成本，计算总佣金（其他业务库，不包括团批）
     * @param value 输入框的数值
     * @param record 当前行的数据
     * @param rowIndex 当前行的索引
     */
    const handleUpdatePlatformProfit = (value: number, record: DataItemType, rowIndex: number, fieldKey?: string) => {
        const memberPrice = Number(record.memberPrice) || 0;
        const settlementPrice = Number(record.settlementPrice) || 0;
        // 安全处理输入值：将非有限数（NaN/Infinity）转为 0
        const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
        // 运营成本上限：最小为 0，防止结算价超出会员价时产生负値
        const profitUpperLimit = Math.max(0, uNumber.toFixed(memberPrice - settlementPrice, 2));
        // 输入值上限等于 会员价 - 供应商结算价，小于 0 时取上限值
        const _value = safeValue > profitUpperLimit ? profitUpperLimit : safeValue;
        // 总佣金 = 会员价 - 供应商结算价 - 平台运营成本，保留2位小数
        const thirdPartyCommission = uNumber.toFixed(memberPrice - settlementPrice - _value, 2);
        handleUpdateValue(_value, 'platformProfit', rowIndex);
        // 更新总佣金
        handleUpdateValue(thirdPartyCommission, fieldKey || 'thirdPartyCommission', rowIndex);

        // 一件代发到店隐藏了推广服务费，同时goodsMarketingProfit变为了总佣金
        if (!isAnxuanCloudToShop) {
            // 更新推广服务费
            const goodsMarketingProfit = mathFloor((thirdPartyCommission * record.goodsMarketingProfitRate) / 100, 2);
            handleUpdateValue(goodsMarketingProfit, 'goodsMarketingProfit', rowIndex);
        }
    };

    // 公共 商品状态表头 组件
    const SkuStatusHeaderRender = (title: string) => (
        <div>
            {tableData.length > 1 && <Switch size="small" checked={allShow} onChange={checked => handleAllChange(checked)} disabled={isView} />}
            {title}
        </div>
    );

    // 公共 预售（天数） 渲染函数
    const PreSaleDaysRender = (record: DataItemType, rowIndex: number) => {
        const { salesStatus, goodsDeliveryAgeing } = record;
        const localGoodsDeliveryAgeing = (goodsDeliveryAgeing || 0) / 24;
        return (
            <div>
                <div style={{ marginBottom: '10px' }}>
                    <Switch
                        disabled={!edit}
                        checked={salesStatus === 1}
                        onChange={status => {
                            if (status) {
                                handleUpdateValue(1, 'salesStatus', rowIndex);
                            } else {
                                handleUpdateValue(0, 'salesStatus', rowIndex);
                                handleUpdateValue(0, 'goodsDeliveryAgeing', rowIndex);
                            }
                        }}
                    />
                </div>
                {salesStatus === 1 && (
                    <>
                        <div>下单后预计可提货时间</div>
                        <InputNumber
                            value={localGoodsDeliveryAgeing}
                            min={1}
                            max={180}
                            precision={0}
                            style={{ width: '200px' }}
                            placeholder="输入预计XX天可提货"
                            onChange={e => {
                                const hours = (e as number) * 24;
                                handleUpdateValue(hours, 'goodsDeliveryAgeing', rowIndex);
                            }}
                        />
                    </>
                )}
            </div>
        );
    };

    // 公共 兑换所需福卡及数量 渲染函数
    const ExchangeRequiredLuckyCardsRender = (record: DataItemType, skuIndex: number) => {
        const cards = record.fuCards || [];
        const isMixed = record.isFlexibleExchange === 1;
        // 混合抵扣模式：使用 totalFuCardsRequired 作为总数量
        const totalQuantity = isMixed ? record.totalFuCardsRequired || 0 : cards.length > 0 ? cards[0]?.fuCardNum || 0 : 0;
        const showViewButton = cards.length > 0 && !edit;

        return (
            <div>
                {cards.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {cards.map((card, cardIndex) => (
                                <span
                                    key={`${record.skuId}-${cardIndex}`}
                                    style={{
                                        padding: '2px 8px',
                                        background: '#f5f5f5',
                                        borderRadius: 4,
                                    }}
                                >
                                    {!isMixed && `  ${card?.fuCardNum}张 `}
                                    {card?.fuCardName}
                                </span>
                            ))}
                        </div>
                        {isMixed && <div style={{ marginTop: 4, color: '#666' }}>总数量: {totalQuantity} 张</div>}
                    </div>
                )}
                {showViewButton ? (
                    <Button type="dashed" onClick={() => handleViewPrize(skuIndex)}>
                        查看福卡
                    </Button>
                ) : (
                    <Button type="dashed" disabled={!edit} onClick={() => handleSelectPrize(skuIndex)}>
                        {cards.length > 0 ? '修改福卡' : '设置福卡'}
                    </Button>
                )}
            </div>
        );
    };

    // 公共 万能券抵扣 渲染函数
    const UniversalCardDeductRender = (record: DataItemType, rowIndex: number) => {
        const universalCouponDeductSwitch = Number(record.isUniversalCardDeductible);
        const universalCouponDeductLimitType = record.universalCardDeductType || UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.COUNT;
        const universalCouponDeductCount = Number(record.universalCardDeductCount ?? UNIVERSAL_CARD_DEDUCT.DEFAULT_COUNT);

        // 计算抵扣限制的最大值：如果是混合抵扣，取 totalFuCardsRequired 作为最大值，否则取 fuCards 数组中数量的和
        const requiredLuckyCardCount = record.isFlexibleExchange === 1 ? Number(record.totalFuCardsRequired) || 0 : (record.fuCards || []).reduce((sum, card) => sum + (Number(card?.fuCardNum) || 0), 0);
        const maxDeductCount = Math.max(UNIVERSAL_CARD_DEDUCT.COUNT_MIN, requiredLuckyCardCount);

        return (
            <div>
                <Switch
                    checked={universalCouponDeductSwitch === UNIVERSAL_CARD_DEDUCT.SWITCH.ON}
                    checkedChildren="支持"
                    unCheckedChildren="不支持"
                    disabled={!edit}
                    onChange={checked => {
                        handleUpdateValue(checked ? UNIVERSAL_CARD_DEDUCT.SWITCH.ON : UNIVERSAL_CARD_DEDUCT.SWITCH.OFF, 'isUniversalCardDeductible', rowIndex);
                        if (checked) {
                            if (!record.universalCardDeductType) {
                                handleUpdateValue(UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.COUNT, 'universalCardDeductType', rowIndex);
                            }
                            if (record.universalCardDeductCount === undefined || record.universalCardDeductCount === null) {
                                handleUpdateValue(UNIVERSAL_CARD_DEDUCT.DEFAULT_COUNT, 'universalCardDeductCount', rowIndex);
                            }
                        }
                    }}
                />

                {universalCouponDeductSwitch === UNIVERSAL_CARD_DEDUCT.SWITCH.ON && (
                    <div style={{ marginTop: 10, display: 'flex' }}>
                        <div style={{ marginBottom: 6 }}>抵扣限制：</div>
                        <Radio.Group
                            value={universalCouponDeductLimitType}
                            disabled={!edit}
                            onChange={e => {
                                const nextType = Number(e.target.value);
                                handleUpdateValue(nextType, 'universalCardDeductType', rowIndex);
                                if (nextType === UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.COUNT && (record.universalCardDeductCount === undefined || record.universalCardDeductCount === null)) {
                                    handleUpdateValue(UNIVERSAL_CARD_DEDUCT.DEFAULT_COUNT, 'universalCardDeductCount', rowIndex);
                                }
                            }}
                        >
                            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
                                <Radio value={UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.COUNT}>限定张数</Radio>
                                {universalCouponDeductLimitType === UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.COUNT && (
                                    <InputNumber
                                        min={UNIVERSAL_CARD_DEDUCT.COUNT_MIN}
                                        max={maxDeductCount}
                                        precision={0}
                                        disabled={!edit}
                                        value={universalCouponDeductCount}
                                        addonAfter="张"
                                        style={{ width: 110, marginLeft: 8 }}
                                        onChange={value => {
                                            const nextValue = Number(value) || UNIVERSAL_CARD_DEDUCT.DEFAULT_COUNT;
                                            handleUpdateValue(Math.min(nextValue, maxDeductCount), 'universalCardDeductCount', rowIndex);
                                        }}
                                    />
                                )}
                            </div>

                            <div>
                                <Radio value={UNIVERSAL_CARD_DEDUCT_LIMIT_TYPE.UNLIMITED}>不限</Radio>
                            </div>
                        </Radio.Group>
                    </div>
                )}
            </div>
        );
    };

    // 公共 优惠抵扣总额 渲染函数
    const DiscountTotalAmountRender = (record: DataItemType, skuIndex: number) => {
        const isEmpty = record.discountTotalAmount === undefined || record.discountTotalAmount === null;
        const isBelowSettlement = !isEmpty && (record.discountTotalAmount ?? 0) < (record.settlementPrice ?? 0);
        const hasError = edit && (isEmpty || isBelowSettlement);

        return (
            <div>
                <InputNumber
                    value={record.discountTotalAmount}
                    min={0.01}
                    precision={2}
                    disabled={!edit}
                    placeholder="请输入"
                    addonAfter="元"
                    style={{ width: 140 }}
                    status={hasError ? 'error' : undefined}
                    onChange={value => {
                        handleUpdateValue(value as number, 'discountTotalAmount', skuIndex);
                        // 福卡兑换：修改优惠抵扣总额时，自动计算平台利润 = 优惠抵扣总额 - 结算价 - 服务费
                        const _discountTotalAmount = Number(value) || 0;
                        const _settlementPrice = Number(record.settlementPrice) || 0;
                        // const _thirdPartyCommission = Number(record.thirdPartyCommission) || 0;
                        const _thirdPartyCommission = 0;
                        const _platformProfit = uNumber.toFixed(_discountTotalAmount - _settlementPrice - _thirdPartyCommission, 2);
                        handleUpdateValue(_platformProfit as number, 'platformProfit', skuIndex);
                    }}
                />
                {hasError && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{isEmpty ? '优惠抵扣总额为必填项' : `不能小于供应商结算价¥${record.settlementPrice}`}</div>}
            </div>
        );
    };

    // 公共 发货时效相关字段 提取
    const getDeliveryCommonColumns = () => {
        if (isShowDeliveryColumns()) {
            return [
                {
                    title: '商品标签',
                    align: 'left' as const,
                    width: 80,
                    dataIndex: 'salesStatus',
                    render: (value: number) => (!!value ? '预售' : '现货'),
                },
                {
                    title: '发货时效',
                    align: 'left' as const,
                    width: 80,
                    dataIndex: 'goodsDeliveryAgeing',
                    render: (value: number, record: DataItemType, index: number) => {
                        const skuInfo = skuDeliveryAgeingInfos.find(item => item.skuId === record.skuId);
                        const options = skuInfo?.ageingOptions || [];
                        if (!productInfo?.spuCode) {
                            // 无spuCode时回退到纯文本展示
                            const tempValue = value / 24;
                            if (tempValue >= cGoods.DefaultGoodsDeliveryAgeingVal) {
                                return `${tempValue}天`;
                            }
                            return cGoods.goodsDeliveryAgeingOptions.find(item => item.value === value)?.title.replace('发货', '') || '不限制';
                        }
                        return (
                            <Select
                                disabled={isView}
                                value={value}
                                style={{ width: '100%' }}
                                onChange={val => {
                                    handleUpdateValue(val, 'goodsDeliveryAgeing', index);
                                    // 预售：发货时效变化时，同步重算最晚发货时间
                                    if (record.salesStatus === 1 && record.startDeliveryTime && val !== undefined && val !== null) {
                                        const endDeliveryTime = dayjs(record.startDeliveryTime).add(Number(val), 'hours').format('YYYY-MM-DD HH:mm:ss');
                                        handleUpdateValue(endDeliveryTime, 'endDeliveryTime', index);
                                    }
                                }}
                            >
                                {options.map(opt => (
                                    <Select.Option key={opt.value} value={opt.value} disabled={opt.disabled}>
                                        {opt.desc}
                                    </Select.Option>
                                ))}
                            </Select>
                        );
                    },
                },
                {
                    title: '开始发货时间',
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'startDeliveryTime',
                    render: (value: string, record: DataItemType) => {
                        // 现货
                        if (!record.salesStatus) return '用户下单时间';

                        return value || '-';
                    },
                },
                {
                    title: '最晚发货时间',
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'endDeliveryTime',
                    render: (value: string, record: DataItemType) => {
                        // 现货且有发货时效
                        if (!record.salesStatus) {
                            let timeText = '';
                            // 自定义发货时间
                            const tempValue = (record.goodsDeliveryAgeing ?? 0) / 24;
                            if (tempValue >= cGoods.DefaultGoodsDeliveryAgeingVal) {
                                timeText = `${tempValue}天`;
                            } else {
                                timeText = cGoods.goodsDeliveryAgeingOptions.find(item => item.value === record.goodsDeliveryAgeing)?.title.replace('发货', '') || '不限制';
                            }

                            return `用户下单时间+${timeText}`;
                        }

                        return value || '不限制';
                    },
                },
                {
                    title: '发货标签',
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'deliveryLabel',
                    render: (value: string) => value || '-',
                },
            ];
        }
        return [];
    };

    /** 是否显示发货相关字段 */
    const isShowDeliveryColumns = () => {
        if ([cGoods.PerformanceEnum.couponCodeRedemption].includes(productInfo?.performance as number)) {
            return false;
        }
        return true;
    };

    // 公共 国补相关字段
    const getNationalSubsidyColumns = () => {
        if (showNationalSubsidyType && !isNil(productInfo.subsidyRuleType)) {
            return [
                {
                    title: getEnergyEfficiencyLevelTitle(productInfo.subsidyRuleType),
                    align: 'left' as const,
                    width: 80,
                    dataIndex: 'efficiencyGrade',
                    render: (_: string, record: DataItemType) => {
                        const value = record.subsidyInfo?.efficiencyGrade;

                        return value ? cGoods.NationalSubsidyEfficiencyGradeLevelMap[value] || value : '——';
                    },
                },
                {
                    title: '国补规则',
                    align: 'left' as const,
                    width: 80,
                    dataIndex: 'subsidyRuleName',
                    render: (_: string, record: DataItemType) => {
                        if (record.subsidyInfo?.subsidyRuleId === 0) {
                            return '不参与国补';
                        }
                        return record.subsidyInfo?.subsidyRuleName || '——';
                    },
                },
                {
                    title: getEnergyEfficiencyLogoTitle(productInfo.subsidyRuleType),
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'efficiencyPic',
                    render: (_: string, record: DataItemType) => {
                        const imgUrls = record.subsidyInfo?.efficiencyPic ? record.subsidyInfo?.efficiencyPic.split(',') : [];
                        if (Array.isArray(imgUrls) && !!imgUrls.length) {
                            return <MultiImageUpload isView imageUrls={imgUrls} />;
                        }

                        return '——';
                    },
                },
                {
                    title: '产品主体图片',
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'productMainPic',
                    render: (_: string, record: DataItemType) => {
                        const imgUrls = record.subsidyInfo?.productMainPic ? record.subsidyInfo?.productMainPic.split(',') : [];
                        if (Array.isArray(imgUrls) && !!imgUrls.length) {
                            return <MultiImageUpload isView imageUrls={imgUrls} />;
                        }

                        return '——';
                    },
                },
                {
                    title: '商品外包装图片',
                    align: 'left' as const,
                    width: 120,
                    dataIndex: 'productPackagePic',
                    render: (_: string, record: DataItemType) => {
                        const imgUrls = record.subsidyInfo?.productPackagePic ? record.subsidyInfo?.productPackagePic.split(',') : [];
                        if (Array.isArray(imgUrls) && !!imgUrls.length) {
                            return <MultiImageUpload isView imageUrls={imgUrls} />;
                        }

                        return '——';
                    },
                },
            ];
        }
        return [];
    };

    /** 安选直播sku设置 */
    const anxuanTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (_value, record) => <span>{record.settlementPrice}</span>,
        },
        {
            title: '会员价(直播会员价)',
            align: 'left',
            width: 120,
            render: (_value, record) => {
                const { memberPrice } = calculatePrices(record);
                const isValid = memberPrice > 0;
                return (
                    <span style={{ color: isValid ? 'inherit' : '#ff4d4f' }}>
                        {uNumber.centToYuan(memberPrice)}
                        {!isValid && <ExclamationCircleOutlined style={{ marginLeft: '4px', color: '#ff4d4f' }} />}
                    </span>
                );
            },
        },
        {
            title: '零售价(直播售价)',
            align: 'left',
            width: 120,
            dataIndex: 'payAmount',
            render: (value, _record, index) => <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} onBlur={e => handleUpdateValue(Number(e.target.value) || 0, 'payAmount', index)} />,
        },
        {
            title: '直播会员优惠',
            align: 'left',
            width: 120,
            dataIndex: 'commissionMoney',
            render: (value, _record, index) => <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} onChange={e => handleUpdateValue(e, 'commissionMoney', index)} />,
        },
        {
            title: '平台预估服务费',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberServiceFee, userServiceFee } = calculatePrices(record);

                return (
                    <div>
                        <div>安选直播平台服务费比例: {serviceFeeRate}%</div>
                        <div>会员预估服务费: ¥{uNumber.centToYuan(memberServiceFee)}</div>
                        <div>用户预估服务费: ¥{uNumber.centToYuan(userServiceFee)}</div>
                    </div>
                );
            },
        },
        {
            title: '门店预估结算价',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberSettlementPrice, userSettlementPrice } = calculatePrices(record);

                return (
                    <div>
                        <div>会员预估结算价: ¥{uNumber.centToYuan(memberSettlementPrice)}</div>
                        <div>用户预估结算价: ¥{uNumber.centToYuan(userSettlementPrice)}</div>
                    </div>
                );
            },
        },
        {
            title: '跨店服务商预估利润',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberProfit, userProfit } = calculatePrices(record);

                return (
                    <div>
                        <div>会员预估利润: ¥{uNumber.centToYuan(memberProfit)}</div>
                        <div>用户预估利润: ¥{uNumber.centToYuan(userProfit)}</div>
                    </div>
                );
            },
        },
        {
            title: (
                <Tooltip title="设置预售提货天数后，用户看到的可提货日期为：当前日期+预售设置提货天数，如下单日期为7.24，预售可提货天数4天，则预计7.28可提货">
                    预售(天数)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 200,
            render: (_value, record, index) => PreSaleDaysRender(record, index),
        },
        {
            title: '商品条码',
            align: 'left',
            width: 120,
            dataIndex: 'barcode',
            render: _value => <span>{_value}</span>,
        },
        {
            title: '净重',
            align: 'left',
            width: 80,
            dataIndex: 'netWeight',
            render: value => <span>{value}</span>,
        },
    ];

    /** 安选货架sku设置 */
    const shelvedTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (_value, record) => <span>{record.settlementPrice}</span>,
        },
        {
            title: '会员价',
            align: 'left',
            width: 120,
            render: (_value, record) => {
                const { memberPrice } = calculatePrices(record);
                const isValid = memberPrice > 0;
                return (
                    <span style={{ color: isValid ? 'inherit' : '#ff4d4f' }}>
                        {uNumber.centToYuan(memberPrice)}
                        {!isValid && <ExclamationCircleOutlined style={{ marginLeft: '4px', color: '#ff4d4f' }} />}
                    </span>
                );
            },
        },
        {
            title: '零售价',
            align: 'left',
            width: 120,
            dataIndex: 'payAmount',
            render: (value, _record, index) => <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} onBlur={e => handleUpdateValue(Number(e.target.value) || 0, 'payAmount', index)} />,
        },
        // fix me 补充服务费
        // fix me 补充平台运营成本
        {
            title: '建议零售价',
            align: 'left',
            width: 120,
            dataIndex: 'suggestRetailPrice',
            render: (value, _record, index) => <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} placeholder="必填" onChange={e => handleUpdateValue(e, 'suggestRetailPrice', index)} />,
        },
        {
            title: '最低零售价(群友价)',
            align: 'left',
            width: 120,
            dataIndex: 'minRetailPrice',
            render: (value, _record, index) => {
                const isValid = value !== undefined && value !== null && _record.suggestRetailPrice !== undefined && _record.suggestRetailPrice !== null && value <= _record.suggestRetailPrice;
                return (
                    <div>
                        <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} placeholder="必填" onChange={e => handleUpdateValue(e, 'minRetailPrice', index)} />
                        {!isValid && value !== undefined && value !== null && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于建议零售价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '会员优惠',
            align: 'left',
            width: 120,
            dataIndex: 'commissionMoney',
            render: (value, _record, index) => <InputNumber value={value} min={0} precision={2} disabled={!edit} style={{ width: '100px' }} onChange={e => handleUpdateValue(e, 'commissionMoney', index)} />,
        },
        {
            title: '平台预估服务费',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberServiceFee, userServiceFee } = calculatePrices(record);

                return (
                    <div>
                        <div>安选直播平台服务费比例: {serviceFeeRate}%</div>
                        <div>会员预估服务费: ¥{uNumber.centToYuan(memberServiceFee)}</div>
                        <div>用户预估服务费: ¥{uNumber.centToYuan(userServiceFee)}</div>
                    </div>
                );
            },
        },
        {
            title: '门店预估结算价',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberSettlementPrice, userSettlementPrice } = calculatePrices(record);

                return (
                    <div>
                        <div>会员预估结算价: ¥{uNumber.centToYuan(memberSettlementPrice)}</div>
                        <div>用户预估结算价: ¥{uNumber.centToYuan(userSettlementPrice)}</div>
                    </div>
                );
            },
        },
        {
            title: '跨店服务商预估利润',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const { memberProfit, userProfit } = calculatePrices(record);

                return (
                    <div>
                        <div>会员预估利润: ¥{uNumber.centToYuan(memberProfit)}</div>
                        <div>用户预估利润: ¥{uNumber.centToYuan(userProfit)}</div>
                    </div>
                );
            },
        },
        {
            title: (
                <Tooltip title="设置预售提货天数后，用户看到的可提货日期为：当前日期+预售设置提货天数，如下单日期为7.24，预售可提货天数4天，则预计7.28可提货">
                    预售(天数)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 200,
            render: (_value, record, index) => PreSaleDaysRender(record, index),
        },
        {
            title: '商品条码',
            align: 'left',
            width: 120,
            dataIndex: 'barcode',
            render: _value => <span>{_value}</span>,
        },
        {
            title: '净重',
            align: 'left',
            width: 80,
            dataIndex: 'netWeight',
            render: value => <span>{value}</span>,
        },
    ];

    /** 社区团购sku设置 */
    const communityTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        // {
        //     title: <Tooltip title='社区团购售价 = 供应商结算价 + 团长利润 + 平台运营成本 + 会员优惠'>
        //         社区团购售价
        //         <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
        //     </Tooltip>,
        //     align: 'left',
        //     width: 130,
        //     dataIndex: 'payAmount',
        //     render: (value, _record, index) => (
        //         <InputNumber
        //             value={value}
        //             min={0}
        //             precision={2}
        //             disabled={!edit}
        //             style={{ width: '100px' }}
        //             placeholder="必填"
        //             onChange={e => handleUpdateValue(e, 'payAmount', index)}
        //         />
        //     ),
        // },
        {
            title: '结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMember = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMember && (value as number) > (record.memberPrice as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const value = e.target?.value || '';
                                handleUpdateValue(value, 'settlementPrice', index);
                                const { goodsMarketingProfitRate } = record;
                                // 修改结算价时，自动计算总佣金和平台运营成本
                                const _settlementPrice = Number(value) || 0;
                                const _memberPrice = Number(record.memberPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                });
                                const _serviceFee = handleCalcTotalCommission({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                    platformProfit: _platformProfit,
                                });
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'communityGroupCommission', index);
                                /** 更新总佣金后更新推广服务费(服务商) */
                                const goodsMarketingProfit = mathFloor((_serviceFee * Number(goodsMarketingProfitRate)) / 100, 2);
                                handleUpdateValue(goodsMarketingProfit as number, 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '会员价',
            align: 'left',
            width: 160,
            dataIndex: 'memberPrice',
            render: (value, record, index) => memberPriceFieldRender(value, record, index, 'payAmount'),
        },
        {
            title: '零售价',
            align: 'left',
            width: 130,
            dataIndex: 'payAmount',
            render: (value, record, index) => retailPriceFieldRender(value, record, index, 'payAmount'),
        },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本=会员价*5%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    width: 120,
                    dataIndex: 'platformProfit',
                    render: (value, record, index) => {
                        // 平台运营成本 = 会员价 * 5%
                        const _value = value < 0 ? handleCalcPlatformProfit(record) : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃
                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index, 'communityGroupCommission')}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 250,
            dataIndex: 'communityGroupCommission',
            render: (value, record, index) => {
                const _value = value < 0 ? handleCalcPlatformProfit(record) : value;
                const { goodsMarketingProfitRate, platformProfitRate } = record;
                // 跨店计算公式
                const computationalFormula = (goodsMarketingProfitRate + (100 - goodsMarketingProfitRate) * ((100 - Number(platformProfitRate)) / 100)) / 100;
                /** 预估基础利润 = 总佣金 *（ 服务费比例 + （（1 - 服务费比例） * (1 - platformProfitRate)）） * 基础服务费利润比例  */
                const baseProfit = uNumber.toFixed((_value * computationalFormula * baseCommunityGroupRate) / 100, 2);
                const crossServiceFee = uNumber.toFixed((_value * computationalFormula * crossMarketingCommissionRate) / 100, 2);
                // const selectedProfit = profitList.find(item => item.code === record.goodsProfitRateCode);
                // const platformProfitRate = selectedProfit?.goodsPlatformProfitRate || 0;
                // const baseProfit = lodash.round(
                //     record?.communityGroupCommission * baseCommunityGroupRate / 100 * (100 - platformProfitRate) / 100,
                //     2,
                // );
                // const crossServiceFee = lodash.round(
                //     record?.communityGroupCommission * crossMarketingCommissionRate / 100 * (100 - platformProfitRate) / 100,
                //     2,
                // );
                return (
                    <>
                        <div>
                            <InputNumber value={_value} min={0} precision={2} disabled style={{ width: '100px' }} placeholder="必填" onChange={e => handleUpdatePlatformProfit(e as number, record, index, 'communityGroupCommission')} />
                        </div>
                        <Flex justify="space-between">
                            <span>预估基础利润：{baseProfit}</span>
                            <span>跨店服务费：{crossServiceFee}</span>
                        </Flex>
                    </>
                );
            },
        },
        {
            title: (
                <Tooltip title="推广服务费(服务商)=总佣金*佣金比例%，默认比例50%，比例浮动33%～66%，举例：15*50%=7.5元">
                    推广服务费(服务商)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 250,
            dataIndex: 'goodsMarketingProfitRate',
            hidden: headerKey === headerKeysEnum.WAREHOUSE_TO_STORE,
            render: (value, record, index) => {
                const { goodsMarketingProfit } = record;
                return (
                    <div>
                        {/* <Select
                            value={record.goodsProfitRateCode}
                            style={{
                                minWidth: '100px',
                                maxWidth: '140px',
                                marginRight: '6px',
                            }}
                            disabled={!edit}
                            showSearch
                            filterOption={false}
                            onSearch={debounceProfitFetcher}
                            onChange={val => handleUpdateValue(val, 'goodsProfitRateCode', index)}
                        >
                            {profitList.map(item => (
                                <Select.Option key={item.code} value={item.code}>{item.name}</Select.Option>
                            ))}
                        </Select> */}
                        <InputNumber style={{ width: 100, marginRight: 8 }} precision={0} min={0} max={100} disabled value={value} placeholder="请输入" addonAfter="%" />
                        <InputNumber
                            style={{ width: 100, marginRight: 8 }}
                            precision={2}
                            min={0}
                            value={goodsMarketingProfit}
                            disabled={!hasPriceEditPermission()}
                            placeholder="请输入"
                            onBlur={e => {
                                const val = e.target.value;
                                if (val !== '' && val != null) {
                                    handleUpdateValue(+val, 'goodsMarketingProfit', index);
                                }
                            }}
                            onPressEnter={e => {
                                const val = (e.target as HTMLInputElement).value;
                                if (val !== '' && val != null) {
                                    const newProfit = +val;
                                    handleUpdateValue(+newProfit, 'goodsMarketingProfit', index);
                                }
                            }}
                        />
                    </div>
                );
            },
        },
        // {
        //     title: '会员优惠',
        //     align: 'left',
        //     width: 120,
        //     dataIndex: 'shopCommissionIntegral',
        //     render: (value, _record, index) => (
        //         <InputNumber
        //             value={value}
        //             min={0}
        //             precision={2}
        //             disabled={!edit}
        //             style={{ width: '100px' }}
        //             placeholder="必填"
        //             onChange={e => handleUpdateValue(e, 'shopCommissionIntegral', index)}
        //         />
        //     ),
        // },
        {
            title: (
                <Tooltip
                    title={
                        <div>
                            <span>中心仓配送费将从供应商结算价扣除</span>
                            <p>供应商实际结算价 = 供应商结算价 - 仓储配送服务费</p>
                        </div>
                    }
                >
                    仓储配送服务费
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 160,
            dataIndex: 'storageDeliveryFee',
            render: (value, record, index) => {
                const _settlementPrice = Number(record.settlementPrice) || 0;
                // 供应商实际结算价 = 供应商结算价 - 仓储配送服务费
                const _supplierSettlementPrice = uNumber.toFixed(_settlementPrice - value, 2);
                /** 是否大于供应商结算价 */
                const isMore = Number(value) >= _settlementPrice;
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onChange={e => {
                                handleUpdateValue(e as number, 'storageDeliveryFee', index);
                            }}
                        />
                        {_supplierSettlementPrice > 0 ? <div style={{ fontSize: '12px', marginTop: '2px' }}>供应商实际结算价：{_supplierSettlementPrice}</div> : null}
                        {isMore && edit ? (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                需要小于供应商结算价
                            </div>
                        ) : null}
                    </div>
                );
            },
        },
        // {
        //     title: '会员价',
        //     align: 'left',
        //     width: 120,
        //     render: (_value, record) => {
        //         const { communityMemberPrice } = calculatePrices(record);
        //         const isValid = communityMemberPrice > 0;
        //         return (
        //             <span style={{ color: isValid ? 'inherit' : '#ff4d4f' }}>
        //                 {uNumber.centToYuan(communityMemberPrice)}
        //                 {!isValid && <ExclamationCircleOutlined style={{ marginLeft: '4px', color: '#ff4d4f' }} />}
        //             </span>
        //         );
        //     },
        // },
        {
            title: (
                <Tooltip title="设置预售提货天数后，用户看到的可提货日期为：当前日期+预售设置提货天数，如下单日期为7.24，预售可提货天数4天，则预计7.28可提货">
                    预售(天数)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 200,
            render: (_value, record, index) => PreSaleDaysRender(record, index),
        },
        {
            title: '分仓时效',
            width: 120,
            dataIndex: 'warehouseDeliveryConfigs',
            render: (value, _record, index) => {
                const isCustom = value?.some((item: WarehouseItem) => item.isCustom);
                return (
                    <Button
                        onClick={() => {
                            setCurrentDeliveryTimeFrameSkuIndex(index);
                            setDeliveryTimeFrameModalVisible(true);
                        }}
                    >
                        {value?.length && isCustom ? '已配置' : '配置分仓时效'}
                    </Button>
                );
            },
        },
        {
            title: '商品条码',
            align: 'left',
            width: 120,
            dataIndex: 'barcode',
            render: _value => <span>{_value}</span>,
        },
    ];

    const handleAddSkuUnitList = (item: DataItemType) => {
        if (item.skuUnitList?.length) {
            const lastItem = item.skuUnitList[item.skuUnitList.length - 1];
            if (!lastItem.unitId) {
                message.error('请先选择上一个销售单元');
                return;
            }
            // console.log(lastItem);
            item.skuUnitList.push({
                num: 1,
                unitName: undefined,
                unitId: undefined,
                parentUnitId: lastItem.unitId,
                parentUnitName: lastItem.unitName,
            });
        } else {
            if (!productInfo.unitId) {
                message.error('请先选择SPU维度的采购单位');
                return;
            }
            item.skuUnitList = [
                {
                    num: 1,
                    unitName: productInfo.unitName,
                    unitId: productInfo.unitId,
                    parentUnitId: productInfo.unitId,
                    parentUnitName: productInfo.unitName,
                },
            ];
        }
        handleResetTableData();
    };

    const handleDeleteSkuUnitList = (item: DataItemType, index: number) => {
        if (!item.skuUnitList?.length) return;
        item.skuUnitList.splice(index, item.skuUnitList.length - 1);
        handleResetTableData();
    };

    /** 获取 SupplierSkuCode 字段对应的标题 */
    const getSupplierSkuCodeTitle = () => {
        if ([cGoods.PerformanceEnum.couponCodeRedemption].includes(productInfo?.performance as number)) {
            return '人群编码';
        }
        return '商品发货编码';
    };

    /** 社区团批sku设置 */
    const batchTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('规则展示'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        // {
        //     title: '成本价',
        //     align: 'left',
        //     width: 120,
        //     dataIndex: 'costPrice',
        //     render: (value, _record, index) => (
        //         <InputNumber
        //             value={value}
        //             min={0}
        //             precision={2}
        //             disabled={!edit}
        //             style={{ width: '100px' }}
        //             placeholder="必填"
        //             onChange={e => handleUpdateValue(e, 'costPrice', index)}
        //         />
        //     ),
        // },
        {
            title: '结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMember = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMember && (value as number) > (record.memberPrice as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const value = e.target?.value || '';
                                handleUpdateValue(value, 'settlementPrice', index);
                                // 修改结算价时，反算会员价 = 结算价 / 0.95，四舍五入保留2位小数
                                const _settlementPrice = Number(value) || 0;
                                const _memberPrice = uNumber.toFixed(_settlementPrice / 0.95, 2);
                                handleUpdateValue(_memberPrice as number, 'memberPrice', index);
                                // 团批场景：总佣金 = 会员价 * 2%，截断保留两位小数 与 会员价 - 结算价 的较小值
                                const _serviceFee = Math.min(mathFloor(_memberPrice * 0.02, 2), _memberPrice - _settlementPrice);
                                // 平台运营成本 = 会员价 - 结算价 - 总佣金
                                const _platformProfit = uNumber.toFixed(_memberPrice - _settlementPrice - _serviceFee, 2);
                                handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '会员价',
            align: 'left',
            width: 160,
            dataIndex: 'memberPrice',
            render: (value, record, index) => memberPriceFieldRender(value, record, index, 'retailPrice'),
        },
        // {
        //     title: '零售价',
        //     align: 'left',
        //     width: 130,
        //     dataIndex: 'retailPrice',
        //     render: (value, record, index) => retailPriceFieldRender(value, record, index, 'retailPrice'),
        // },
        // {
        //     title: '推广服务费（服务商）',
        //     align: 'left',
        //     width: 180,
        //     dataIndex: 'thirdPartyCommission',
        //     render: (_text, record, index) => (
        //         <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>

        //             <Select
        //                 value={record.goodsProfitRateCode}
        //                 style={{
        //                     minWidth: '100px',
        //                     maxWidth: '140px',
        //                     marginRight: '6px',
        //                 }}
        //                 disabled={!edit}
        //                 showSearch
        //                 filterOption={false}
        //                 onSearch={debounceProfitFetcher}
        //                 onChange={val => handleUpdateValue(val, 'goodsProfitRateCode', index)}
        //             >
        //                 {profitList.map(item => (
        //                     <Select.Option key={item.code} value={item.code}>{item.name}</Select.Option>
        //                 ))}
        //             </Select>
        //             <InputNumber
        //                 style={{ width: 100, marginRight: 8 }}
        //                 precision={0}
        //                 min={33}
        //                 max={66}
        //                 disabled
        //                 value={record.goodsMarketingProfitRate}
        //                 placeholder='请输入'
        //                 addonAfter='%'
        //                 onChange={e => handleUpdateValue(e as number, 'goodsMarketingProfitRate', index)}
        //             />
        //             <InputNumber
        //                 style={{ width: 100, marginRight: 8 }}
        //                 precision={2}
        //                 min={0}
        //                 value={record.goodsMarketingProfit}
        //                 placeholder='请输入'
        //                 onBlur={e => {
        //                     const val = e.target.value;
        //                     if (val !== '' && val != null) {
        //                         handleUpdateValue(+val, 'goodsMarketingProfit', index);
        //                     }
        //                 }}
        //             />
        //         </div>
        //     ),
        // },
        // {
        //     title: '会员返积分',
        //     align: 'left',
        //     dataIndex: 'shopCommissionIntegral',
        //     key: 'shopCommissionIntegral',
        //     width: 260,
        //     render: (_text: string, record, index: number) => {
        //         // 零售价
        //         const retail = Number(record.retailPrice) || 0;
        //         const rate = Number(record.shopCommissionIntegralRate); // 百分比
        //         const pointValue = Number(record.shopCommissionIntegral ?? Math.floor(retail * rate / 100));
        //         return (
        //             <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        //                 {!edit ? (
        //                     <div style={{ display: 'flex', flexDirection: 'column' }}>
        //                         <div>{`会员返积分比例：${rate}%`}</div>
        //                         <div>{`积分值：${pointValue}`}</div>
        //                     </div>
        //                 ) : (
        //                     <>
        //                         <InputNumber
        //                             style={{ width: 100, marginRight: 8 }}
        //                             min={0}
        //                             precision={2}
        //                             value={rate}
        //                             placeholder='请输入比例'
        //                             formatter={v => (v === undefined || v === null ? '' : `${v}%`)}
        //                             parser={v => (v ? Number(String(v).replace('%', '')) : 0)}
        //                             onChange={val => handleUpdateValue(Math.max(0, Number(val || 0)), 'shopCommissionIntegralRate', index)}
        //                         />
        //                         <InputNumber
        //                             style={{ width: 80 }}
        //                             min={0}
        //                             precision={0}
        //                             value={pointValue}
        //                             placeholder='请输入值'
        //                             onChange={val => handleUpdateValue(Number(val || 0), 'shopCommissionIntegral', index)}
        //                         />
        //                     </>
        //                 )}
        //             </div>
        //         );
        //     },
        // },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本 = 会员价 * 5%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    width: 120,
                    dataIndex: 'platformProfit',
                    render: (value: number, record, index) => {
                        const { memberPrice, settlementPrice } = record;
                        // 平台运营成本 = 会员价 * 5%
                        const _serviceFee = handleCalcGroupBatchTotalCommission(record);
                        const _platformProfit = uNumber.toFixed(Number(memberPrice) - Number(settlementPrice) - Number(_serviceFee), 2);

                        const _value = value < 0 ? _platformProfit : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃

                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index)}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'thirdPartyCommission',
            render: (value, record, index) => {
                if (value < 0) {
                    const _serviceFee = handleCalcGroupBatchTotalCommission(record);
                    handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                }
                // 先计算总佣金，在计算平台运营成本
                return (
                    <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                        <InputNumber
                            style={{ width: 80, marginRight: 8 }}
                            min={0}
                            max={priceMax}
                            disabled
                            precision={2}
                            value={record.thirdPartyCommission}
                            placeholder="请输入"
                            onChange={e => handleUpdateValue(e as number, 'thirdPartyCommission', index)}
                        />
                    </div>
                );
            },
        },
        {
            title: '商品条形码',
            align: 'left',
            width: 120,
            dataIndex: 'barcode',
            render: _value => <span>{_value}</span>,
        },
        ...getDeliveryCommonColumns(),
        {
            title: getSupplierSkuCodeTitle(),
            align: 'left',
            width: 120,
            dataIndex: 'supplierSkuCode',
            render: _value => <span>{_value}</span>,
        },
        {
            title: (
                <Tooltip title="指商品在团批采购使用的标准基准单位，用户按此单位起批下单；例如：按箱、盒、袋采购。">
                    采购单位
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 80,
            dataIndex: '',
            render: () => productInfo.unitName,
        },
        {
            title: (
                <Tooltip title="指商品在销售给终端门店或消费者时使用的结算单位；例如：按瓶、包、斤销售。">
                    销售单元
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 80,
            dataIndex: 'isShowSalesUnit',
            render: (value, _record, index) => <Switch checked={value === 1 ? true : false} onChange={checked => handleUpdateValue(checked ? 1 : 0, 'isShowSalesUnit', index)} disabled={!edit} />,
        },
        {
            title: (
                <Tooltip title="指采购单位与销售单元之间的数量换算关系；例如：1箱=12瓶，则换算值为12。">
                    销售单元换算
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 300,
            dataIndex: '',
            render: (_value, _record, index) =>
                !_record.isShowSalesUnit ? (
                    <InputNumber addonBefore={`1 ${productInfo.unitName}=`} addonAfter={`基准单位 | ${productInfo.unitName}`} value={1} defaultValue={1} disabled />
                ) : (
                    <div>
                        {_record.skuUnitList?.map((item, index2) => (
                            <div
                                style={{
                                    marginBottom: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                }}
                                key={`${index2}-${item.unitName}-${item.unitId}`}
                            >
                                <InputNumber
                                    min={1}
                                    max={99999}
                                    disabled={!edit}
                                    addonBefore={`1 ${index2 === 0 ? productInfo.unitName : item.parentUnitName}=`}
                                    addonAfter={
                                        <Select
                                            placeholder="请选择"
                                            showSearch
                                            filterOption={false}
                                            defaultValue={item.unitName}
                                            style={{
                                                minWidth: '100px',
                                                maxWidth: '150px',
                                            }}
                                            disabled={!edit}
                                            onSearch={debounceFetcher}
                                            onChange={(_value, option) => {
                                                if (Array.isArray(option)) return;
                                                handleChangeUnitName(option.data as UnitList, item, _record.skuUnitList || []);
                                            }}
                                        >
                                            {unitList?.map(brand => (
                                                <Select.Option key={brand.id} value={brand.id} data={brand}>
                                                    {brand.name}（{unitTypeConst[brand.type]}）
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    }
                                    value={item.num}
                                    defaultValue={item.num}
                                    onChange={num => {
                                        item.num = Number(num);
                                        handleUpdateValue(Number(_record.isShowSalesUnit), 'isShowSalesUnit', index);
                                    }}
                                />
                                {index2 !== 0 && edit ? (
                                    <Popconfirm title={'确认是否删除？'} onConfirm={() => handleDeleteSkuUnitList(_record, index2)} disabled={!edit}>
                                        <Button type="link">删除</Button>
                                    </Popconfirm>
                                ) : null}
                            </div>
                        ))}
                        {!edit ? null : (
                            <Button
                                disabled={!edit}
                                onClick={() => {
                                    handleAddSkuUnitList(_record);
                                }}
                                type="link"
                            >
                                添加销售单元
                            </Button>
                        )}
                    </div>
                ),
        },
        {
            title: (
                <Tooltip title="指商品允许下单的最小采购数量，低于该数量不可下单；例如：起批量为10，表示至少采购10箱。">
                    <span style={{ color: 'red' }}>起批量(范围是1-99999)</span>
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 150,
            dataIndex: 'minPurchaseNum',
            render: (val, record) => (
                <InputNumber
                    addonAfter={productInfo.unitName}
                    min={1}
                    max={99999}
                    value={val}
                    disabled={!edit}
                    onChange={value => {
                        record.minPurchaseNum = value;
                        handleResetTableData();
                    }}
                />
            ),
        },
        {
            title: (
                <Tooltip title="指商品下单数量需满足的倍数规则；例如：倍数为5，则只能按5、10、15等数量下单。">
                    起批倍数
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 80,
            dataIndex: 'isPurchaseNumMultiple',
            render: (value, _record, index) => <Switch disabled={!edit} checked={value === 1 ? true : false} onChange={checked => handleUpdateValue(checked ? 1 : 0, 'isPurchaseNumMultiple', index)} />,
        },
    ];

    /** 正式库sku设置 */
    const NormalTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '增值税税率',
            dataIndex: 'supplierTaxRate',
            key: 'supplierTaxRate',
            hidden: headerKey !== headerKeysEnum.BENEFIT_GOODS,
            width: 120,
            render: (val: number) => (val !== undefined && val !== null ? `${(val * 100).toFixed(2)}%` : '--'),
        },
        // {
        //     title: '成本价',
        //     align: 'left',
        //     width: 120,
        //     dataIndex: 'costPrice',
        //     render: (value, _record, index) => (
        //         <InputNumber
        //             value={value}
        //             min={0}
        //             precision={2}
        //             disabled={!edit}
        //             style={{ width: '100px' }}
        //             placeholder="必填"
        //             onChange={e => handleUpdateValue(e, 'costPrice', index)}
        //         />
        //     ),
        // },
        {
            title: '供应商结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMember = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMember && (value as number) > (record.memberPrice as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const value = e.target?.value || '';
                                handleUpdateValue(value, 'settlementPrice', index);
                                const { goodsMarketingProfitRate } = record;
                                // 修改结算价时，自动计算总佣金和平台运营成本
                                const _settlementPrice = Number(value) || 0;
                                const _memberPrice = Number(record.memberPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                });
                                const _serviceFee = handleCalcTotalCommission({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                    platformProfit: _platformProfit,
                                });
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                                /** 更新总佣金后更新推广服务费(服务商) */
                                const goodsMarketingProfit = mathFloor((_serviceFee * Number(goodsMarketingProfitRate)) / 100, 2);
                                handleUpdateValue(goodsMarketingProfit as number, 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '会员价',
            align: 'left',
            width: 160,
            dataIndex: 'memberPrice',
            render: (value, record, index) => memberPriceFieldRender(value, record, index, 'retailPrice'),
        },
        {
            title: '零售价',
            dataIndex: 'retailPrice',
            key: 'retailPrice',
            align: 'left',
            width: 100,
            render: (value, record, index) => retailPriceFieldRender(value, record, index, 'retailPrice'),
        },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本 = 会员价 * 5%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    dataIndex: 'platformProfit',
                    key: 'platformProfit',
                    width: 130,
                    render: (value, record, index) => {
                        // 平台运营成本 = 会员价 * 5%
                        const _value = value < 0 ? handleCalcPlatformProfit(record) : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃
                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index)}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'thirdPartyCommission',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <InputNumber
                        style={{ width: 80, marginRight: 8 }}
                        min={0}
                        max={priceMax}
                        disabled
                        precision={2}
                        value={record.thirdPartyCommission}
                        placeholder="请输入"
                        onChange={e => handleUpdateValue(e as number, 'thirdPartyCommission', index)}
                    />
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="推广服务费(服务商)=总佣金*佣金比例%，默认比例50%，比例浮动33%～66%，举例：15*50%=7.5元">
                    推广服务费(服务商)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'goodsMarketingProfitRate',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    {/* <Select
                        value={record.goodsProfitRateCode}
                        style={{
                            minWidth: '100px',
                            maxWidth: '140px',
                            marginRight: '6px',
                        }}
                        disabled={!edit}
                        showSearch
                        filterOption={false}
                        onSearch={debounceProfitFetcher}
                        onChange={val => handleUpdateValue(val, 'goodsProfitRateCode', index)}
                    >
                        {profitList.map(item => (
                            <Select.Option key={item.code} value={item.code}>{item.name}</Select.Option>
                        ))}
                    </Select> */}
                    <InputNumber
                        style={{ width: 100, marginRight: 8 }}
                        precision={0}
                        min={record.isValuableGoods ? 0 : 33}
                        max={record.isValuableGoods ? 100 : 66}
                        disabled
                        value={record.goodsMarketingProfitRate}
                        placeholder="请输入"
                        addonAfter="%"
                        onChange={e => handleUpdateValue(e as number, 'goodsMarketingProfitRate', index)}
                    />
                    <InputNumber
                        style={{ width: 100, marginRight: 8 }}
                        precision={2}
                        min={0}
                        disabled={!hasPriceEditPermission()}
                        value={record.goodsMarketingProfit || 0}
                        placeholder="请输入"
                        onBlur={e => {
                            const val = e.target.value;
                            if (val !== '' && val != null) {
                                handleUpdateValue(+val, 'goodsMarketingProfit', index);
                            }
                        }}
                        onPressEnter={e => {
                            const val = (e.target as HTMLInputElement).value;
                            if (val !== '' && val != null) {
                                const newProfit = +val;
                                handleUpdateValue(+newProfit, 'goodsMarketingProfit', index);
                            }
                        }}
                    />
                </div>
            ),
        },
        // {
        //     title: '会员返积分',
        //     align: 'left',
        //     dataIndex: 'shopCommissionIntegral',
        //     key: 'shopCommissionIntegral',
        //     width: 260,
        //     render: (_text: string, record, index: number) => {
        //         // 零售价
        //         const retail = Number(record.retailPrice) || 0;
        //         const rate = Number(record.shopCommissionIntegralRate); // 百分比
        //         const pointValue = Number(record.shopCommissionIntegral ?? Math.floor(retail * rate / 100));
        //         return (
        //             <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        //                 {!edit ? (
        //                     <div style={{ display: 'flex', flexDirection: 'column' }}>
        //                         <div>{`会员返积分比例：${rate}%`}</div>
        //                         <div>{`积分值：${pointValue}`}</div>
        //                     </div>
        //                 ) : (
        //                     <>
        //                         <InputNumber
        //                             style={{ width: 100, marginRight: 8 }}
        //                             min={0}
        //                             precision={2}
        //                             value={rate}
        //                             placeholder='请输入比例'
        //                             formatter={v => (v === undefined || v === null ? '' : `${v}%`)}
        //                             parser={v => (v ? Number(String(v).replace('%', '')) : 0)}
        //                             onChange={val => handleUpdateValue(Math.max(0, Number(val || 0)), 'shopCommissionIntegralRate', index)}
        //                         />
        //                         <InputNumber
        //                             style={{ width: 80 }}
        //                             min={0}
        //                             precision={0}
        //                             value={pointValue}
        //                             placeholder='请输入值'
        //                             onChange={val => handleUpdateValue(Number(val || 0), 'shopCommissionIntegral', index)}
        //                         />
        //                     </>
        //                 )}
        //             </div>
        //         );
        //     },
        // },
        // {
        //     title: '零售价',
        //     dataIndex: 'retailPrice',
        //     key: 'retailPrice',
        //     align: 'left',
        //     width: 100,
        //     render: (text, record, index) => {
        //         // 最小零售价 = 结算价 + 服务费 + (会员返积分 / 100) + 手续费 + 税费(零售价 * 税率)
        //         const _retailPrice = Number(record.retailPrice) || 0;
        //         const _settlementPrice = Number(record.settlementPrice) || 0;
        //         const _serviceFee = Number(record.thirdPartyCommission) || 0;
        //         const _memberPoint = (record.shopCommissionIntegral / 100) || 0;

        //         // const _handleFee = Number((_retailPrice * 0.006).toFixed(2));
        //         const _taxationFee = mathFloor(_retailPrice * record.taxation / 100, 2) || 0;

        //         const minRetailPrice = mathFloor((_settlementPrice + _serviceFee + _memberPoint + _taxationFee), 2);

        //         return (
        //              !edit
        //                 ? <div
        //                     style={{
        //                         display: 'flex',
        //                         justifyContent: 'center',
        //                         flexDirection: 'column',
        //                         height: '100%',
        //                     }}
        //                 >
        //                     <div>{text}</div>
        //                     <div>最小零售价￥{minRetailPrice}</div>
        //                 </div>
        //                 : (
        //                     <div style={{
        //                         display: 'flex',
        //                         flexDirection: 'column',
        //                         justifyContent: 'center',
        //                         height: '100%',
        //                     }}>
        //                         <InputNumber
        //                             style={{ width: '92px' }}
        //                             placeholder='请输入'
        //                             precision={2}
        //                             max={priceMax}
        //                             min={priceMin}
        //                             disabled={!edit}
        //                             value={record.retailPrice}
        //                             onChange={value => handleUpdateValue(value as number, 'retailPrice', index)}
        //                         />
        //                         <div className='mt10 more-desc'>最小零售价<span className='danger-text'>￥{minRetailPrice}</span></div>
        //                     </div>
        //                 )
        //         );
        //     },
        // },

        ...getDeliveryCommonColumns(),
        {
            title: getSupplierSkuCodeTitle(),
            align: 'left',
            width: 120,
            dataIndex: 'supplierSkuCode',
            render: (value, _record, index) => (
                <Input
                    value={value}
                    // disabled={!edit}
                    disabled
                    style={{ width: '100px' }}
                    placeholder="必填"
                    onChange={e => handleUpdateValue(e.target.value, 'supplierSkuCode', index)}
                />
            ),
        },
        ...getNationalSubsidyColumns(),
    ];

    /** 一件代发到店 */
    const anxuanCloudToShopTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '供应商结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMember = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMember && (Number(value) as number) > (Number(record.memberPrice) as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const _value = e.target?.value || '';
                                handleUpdateValue(_value, 'settlementPrice', index);
                                // 修改结算价时，自动计算总佣金和平台运营成本
                                const _settlementPrice = Number(_value) || 0;
                                const _memberPrice = Number(record.memberPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit(
                                    {
                                        memberPrice: _memberPrice,
                                        settlementPrice: _settlementPrice,
                                    },
                                    0.08,
                                );
                                const _serviceFee = handleCalcTotalCommission({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                    platformProfit: _platformProfit,
                                });
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'goodsMarketingProfit', index);
                                // 更新推广服务费(服务商)
                                // handleUpdateValue(mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2), 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: (
                <Tooltip title="安选直播会员价">
                    会员价
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 120,
            dataIndex: 'memberPrice',
            render: (value, record, index) => {
                const hasSettle = record.settlementPrice !== undefined && record.settlementPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasSettle && (value as number) < (Number(record.settlementPrice) as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const _value = e.target?.value || '';
                                handleUpdateValue(_value, 'memberPrice', index);
                                // 修改会员价时，自动计算总佣金和平台运营成本
                                const _memberPrice = Number(_value) || 0;
                                const _settlementPrice = Number(record.settlementPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit(
                                    {
                                        memberPrice: _memberPrice,
                                        settlementPrice: _settlementPrice,
                                    },
                                    0.08,
                                );
                                const _serviceFee = uNumber.toFixed(_memberPrice - _settlementPrice - _platformProfit, 2);
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'goodsMarketingProfit', index);
                                // 更新推广服务费(服务商)
                                // handleUpdateValue(mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2), 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能小于结算价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: (
                <Tooltip title="安选直播零售价">
                    零售价
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            dataIndex: 'retailPrice',
            key: 'retailPrice',
            align: 'left',
            width: 100,
            render: (value, record, index) => retailPriceFieldRender(value, record, index, 'retailPrice'),
        },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本 = 会员价 * 8%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    dataIndex: 'platformProfit',
                    key: 'platformProfit',
                    width: 130,
                    render: (value, record, index) => {
                        // 平台运营成本 = 会员价 * 8%
                        const _value = value < 0 ? handleCalcPlatformProfit(record, 0.08) : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃

                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index, 'goodsMarketingProfit')}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="一件代发到店订单的门店服务商利润和平台运营成本(按照商品档案配置比例计算)">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'goodsMarketingProfit',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <InputNumber
                        style={{ width: 80, marginRight: 8 }}
                        min={0}
                        max={priceMax}
                        disabled
                        precision={2}
                        value={record.goodsMarketingProfit}
                        placeholder="请输入"
                        onChange={e => handleUpdateValue(e as number, 'goodsMarketingProfit', index)}
                    />
                </div>
            ),
        },
        // {
        //     title: (
        //         <Tooltip title="一件代发到店订单的门店服务商利润和平台运营成本(按照商品档案配置比例计算)">
        //             总佣金
        //             <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
        //         </Tooltip>
        //     ),
        //     align: 'left',
        //     width: 180,
        //     dataIndex: 'thirdPartyCommission',
        //     render: (_text, record, index) => (
        //         <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        //             <InputNumber
        //                 style={{ width: 80, marginRight: 8 }}
        //                 min={0}
        //                 max={priceMax}
        //                 disabled
        //                 precision={2}
        //                 value={record.thirdPartyCommission}
        //                 placeholder="请输入"
        //                 onChange={e => handleUpdateValue(e as number, 'thirdPartyCommission', index)}
        //             />
        //         </div>
        //     ),
        // },
        // {
        //     title: (
        //         <Tooltip title="推广服务费(服务商)=总佣金*佣金比例%，默认比例50%，比例浮动33%～66%，举例：15*50%=7.5元">
        //             推广服务费(服务商)
        //             <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
        //         </Tooltip>
        //     ),
        //     align: 'left',
        //     width: 250,
        //     dataIndex: 'goodsMarketingProfitRate',
        //     render: (value, record, index) => {
        //         const { goodsMarketingProfit } = record;
        //         return (
        //             <div>
        //                 <InputNumber
        //                     style={{ width: 100, marginRight: 8 }}
        //                     precision={0}
        //                     disabled
        //                     min={0}
        //                     max={100}
        //                     value={value}
        //                     placeholder="请输入"
        //                     addonAfter="%"
        //                 />
        //                 <InputNumber
        //                     style={{ width: 100, marginRight: 8 }}
        //                     precision={2}
        //                     min={0}
        //                     value={goodsMarketingProfit}
        //                     disabled={!hasPriceEditPermission()}
        //                     placeholder="请输入"
        //                     onBlur={e => {
        //                         const val = e.target?.value || '';
        //                         if (val !== '' && val != null) {
        //                             handleUpdateValue(+val, 'goodsMarketingProfit', index);
        //                         }
        //                     }}
        //                     onPressEnter={e => {
        //                         const val = (e.target as HTMLInputElement).value;
        //                         if (val !== '' && val != null) {
        //                             const newProfit = +val;
        //                             handleUpdateValue(+newProfit, 'goodsMarketingProfit', index);
        //                         }
        //                     }}
        //                 />
        //             </div>
        //         );
        //     },
        // },
        {
            title: '跨店服务费',
            align: 'left',
            width: 250,
            dataIndex: 'thirdPartyCommission',
            render: (_value, record) => {
                const { goodsMarketingProfit } = record;
                const crossServiceFee = mathFloor((goodsMarketingProfit * crossMarketingCommissionRate) / 100, 2);

                return <span>跨店服务费：{crossServiceFee}</span>;
            },
        },
        ...getDeliveryCommonColumns(),
        {
            title: getSupplierSkuCodeTitle(),
            align: 'left',
            width: 120,
            dataIndex: 'supplierSkuCode',
            render: (value, _record, index) => (
                <Input
                    value={value}
                    // disabled={!edit}
                    disabled
                    style={{ width: '100px' }}
                    placeholder="必填"
                    onChange={e => handleUpdateValue(e.target.value, 'supplierSkuCode', index)}
                />
            ),
        },
    ];
    /** 企业内购sku设置 */
    const internalPurchaseTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '增值税税率',
            dataIndex: 'supplierTaxRate',
            key: 'supplierTaxRate',
            width: 120,
            render: (val: number) => (val !== undefined && val !== null ? `${(val * 100).toFixed(2)}%` : '--'),
        },
        {
            title: '供应商结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMemberPrice = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMemberPrice && (value as number) > (record.memberPrice as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const value = e?.target?.value;
                                handleUpdateValue(value, 'settlementPrice', index);
                                // 修改结算价时，用新输入的结算价重新计算平台运营成本和总佣金
                                const _settlementPrice = Number(value) || 0;
                                const _memberPricePrice = Number(record.memberPrice) || 0;
                                // 用新结算价计算平台运营成本
                                const _platformProfit = handleCalcPlatformProfit({
                                    memberPrice: _memberPricePrice,
                                    settlementPrice: _settlementPrice,
                                });
                                // 用新结算价计算总佣金
                                const _serviceFee = handleCalcTotalCommission({
                                    memberPrice: _memberPricePrice,
                                    settlementPrice: _settlementPrice,
                                    platformProfit: _platformProfit,
                                });
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                                // 更新推广服务费(服务商)
                                handleUpdateValue(mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2), 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于等于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '会员价',
            dataIndex: 'memberPrice',
            key: 'memberPrice',
            align: 'left',
            width: 100,
            render: (_text, record, index) => {
                const _memberPrice = Number(record.memberPrice) || 0;
                const hasMemberPrice = record.memberPrice !== undefined && record.memberPrice !== null;
                const invalidMember = hasMemberPrice && _memberPrice < (record.memberPrice as number);
                return (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            height: '100%',
                        }}
                    >
                        <InputNumber
                            style={{ width: '92px' }}
                            placeholder="请输入"
                            precision={2}
                            max={priceMax}
                            min={priceMin}
                            disabled={!edit}
                            value={record.memberPrice}
                            onBlur={e => {
                                const value = Number(e.target?.value) || 0;
                                // 会员价零售价一致，所以同时变动
                                handleUpdateValue(value, 'memberPrice', index);
                                handleUpdateValue(value, 'retailPrice', index);
                                // 会员价变动时，用新会员价重新计算平台运营成本和总佣金
                                const _memberPrice = Number(value) || 0;
                                const _settlementPrice = Number(record.settlementPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                });
                                const _serviceFee = handleCalcTotalCommission({
                                    memberPrice: _memberPrice,
                                    settlementPrice: _settlementPrice,
                                    platformProfit: _platformProfit,
                                });
                                handleUpdateValue(_platformProfit, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                                // 更新推广服务费(服务商)
                                handleUpdateValue(mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2), 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalidMember && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能小于结算价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '零售价',
            dataIndex: 'retailPrice',
            key: 'retailPrice',
            align: 'left',
            width: 100,
            render: (_text, record) => <span>{record.retailPrice}</span>,
        },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本 = 会员价 * 5%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    dataIndex: 'platformProfit',
                    key: 'platformProfit',
                    width: 130,
                    render: (value, record, index) => {
                        // 平台运营成本 = 会员价 * 5%
                        const _value = value < 0 ? handleCalcPlatformProfit(record) : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃
                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index)}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'thirdPartyCommission',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <InputNumber
                        style={{ width: 80, marginRight: 8 }}
                        min={0}
                        max={priceMax}
                        disabled
                        precision={2}
                        value={record.thirdPartyCommission}
                        placeholder="请输入"
                        onChange={e => handleUpdateValue(e as number, 'thirdPartyCommission', index)}
                    />
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="推广服务费(服务商)=总佣金*佣金比例%，默认比例50%，比例浮动33%～66%，举例：15*50%=7.5元">
                    推广服务费(服务商)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'goodsMarketingProfitRate',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    {/* <Select
                        value={record.goodsProfitRateCode}
                        style={{
                            minWidth: '100px',
                            maxWidth: '140px',
                            marginRight: '6px',
                        }}
                        disabled={!edit}
                        showSearch
                        filterOption={false}
                        onSearch={debounceProfitFetcher}
                        onChange={val => handleUpdateValue(val, 'goodsProfitRateCode', index)}
                    >
                        {profitList.map(item => (
                            <Select.Option key={item.code} value={item.code}>{item.name}</Select.Option>
                        ))}
                    </Select> */}
                    <InputNumber
                        style={{ width: 100, marginRight: 8 }}
                        precision={0}
                        min={record.isValuableGoods ? 0 : 33}
                        max={record.isValuableGoods ? 100 : 66}
                        disabled
                        value={record.goodsMarketingProfitRate}
                        placeholder="请输入"
                        addonAfter="%"
                        onChange={e => handleUpdateValue(e as number, 'goodsMarketingProfitRate', index)}
                    />
                    <InputNumber
                        style={{ width: 100, marginRight: 8 }}
                        precision={2}
                        min={0}
                        disabled={!hasPriceEditPermission()}
                        value={record.goodsMarketingProfit || 0}
                        placeholder="请输入"
                        onBlur={e => {
                            const val = e.target.value;
                            if (val !== '' && val != null) {
                                handleUpdateValue(+val, 'goodsMarketingProfit', index);
                            }
                        }}
                        onPressEnter={e => {
                            const val = (e.target as HTMLInputElement).value;
                            if (val !== '' && val != null) {
                                const newProfit = +val;
                                handleUpdateValue(+newProfit, 'goodsMarketingProfit', index);
                            }
                        }}
                    />
                </div>
            ),
        },
        ...getDeliveryCommonColumns(),
        {
            title: '商品发货编码',
            align: 'left',
            width: 120,
            dataIndex: 'supplierSkuCode',
            render: (value, _record, index) => (
                <Input
                    value={value}
                    // disabled={!edit}
                    disabled
                    style={{ width: '100px' }}
                    placeholder="必填"
                    onChange={e => handleUpdateValue(e.target.value, 'supplierSkuCode', index)}
                />
            ),
        },
    ];

    const handleSelectPrize = (skuIndex: number) => {
        setCurrentSkuIndex(skuIndex);
        setShowSelectPrizeModal(true);
    };

    const handleViewPrize = (skuIndex: number) => {
        setCurrentViewSkuIndex(skuIndex);
        setShowViewPrizeModal(true);
    };

    // 福卡选择确认回调（多选模式）
    const handlePrizeSelected = (luckyCardsInfo: LuckyCardSelectInfo[], totalFuCardsRequired?: number) => {
        if (currentSkuIndex >= 0) {
            const tableList = [...tableData];
            const target = tableList[currentSkuIndex];
            // 获取原有的福卡列表，保留 id 和 minPayNum
            const existingList = Array.isArray(target.fuCards) ? [...target.fuCards] : [];
            // 合并新选择的福卡，保留原有的 id 和 minPayNum
            const newList = luckyCardsInfo.map(newCard => {
                const existing = existingList.find(c => c.fuCardId === newCard.fuCardId);
                return existing ? { ...newCard, id: existing.id, minPayNum: existing.minPayNum } : { ...newCard, id: undefined };
            });
            target.fuCards = newList;
            handleUpdateValue(newList, 'fuCards', currentSkuIndex);
            // 混合抵扣模式：保存福卡总数量
            if (totalFuCardsRequired !== undefined) {
                handleUpdateValue(totalFuCardsRequired, 'totalFuCardsRequired', currentSkuIndex);
            }
        }
        setShowSelectPrizeModal(false);
        setCurrentSkuIndex(-1);
    };

    // 打开批量设置福卡弹窗
    const handleOpenBatchLuckyCardModal = () => {
        // 批量设置时默认为空，不受已有sku福卡配置影响
        setBatchLuckyCards([]);
        setBatchLuckyCardMixedDeduction(0); // 开关默认关闭
        setBatchTotalFuCardsRequired(1); // 总数量默认为1
        // 同步更新 ref
        batchLuckyCardsRef.current = [];
        batchLuckyCardMixedDeductionRef.current = 0;
        batchTotalFuCardsRequiredRef.current = 1;
        setShowBatchLuckyCardModal(true);
    };

    // 批量设置福卡确认
    const handleBatchLuckyCardConfirm = () => {
        // 使用 ref 获取最新值，避免闭包问题
        const luckyCardsInfo = batchLuckyCardsRef.current;
        const mixedDeduction = batchLuckyCardMixedDeductionRef.current;
        const totalFuCards = batchTotalFuCardsRequiredRef.current;

        // 应用到所有SKU
        const tableList = tableData.map(item => ({
            ...item,
            fuCards: luckyCardsInfo.map(card => ({ ...card, id: undefined })),
            isFlexibleExchange: mixedDeduction,
            // 混合抵扣模式下设置福卡总数量
            ...(mixedDeduction === 1 ? { totalFuCardsRequired: totalFuCards } : {}),
        }));
        // 批量更新
        if (handleUpdateTableData) {
            handleUpdateTableData(tableList);
        }
        setShowBatchLuckyCardModal(false);
        setBatchLuckyCards([]);
        setBatchLuckyCardMixedDeduction(0);
        setBatchTotalFuCardsRequired(1);
        // 重置 ref
        batchLuckyCardsRef.current = [];
        batchLuckyCardMixedDeductionRef.current = 0;
        batchTotalFuCardsRequiredRef.current = 1;
    };

    /** 福利商城sku设置 */
    const IntegralGoodsTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 300,
            dataIndex: 'propertyValuesStr',
            render: (_value, record) => (
                <Flex align="center">
                    <Image width={60} height={60} src={record.propPicUrl} />
                    <span className="ml10" style={{ width: '230px' }}>
                        {record.skuDesc}
                    </span>
                </Flex>
            ),
        },
        {
            title: '供应商结算价',
            align: 'left',
            width: 130,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasValue = value !== undefined && value !== null;
                // 非福卡兑换：不能大于积分抵扣等值金额 + 支付金额
                const invalid = productInfo.exchangeType !== cGoods.ExchangeType.LUCKY_CARD_EXCHANGE && hasValue && value > uNumber.toFixed(uNumber.centToYuan(record.discountIntegral) + (record.payAmount || 0), 2);
                // 福卡兑换：供应商结算价不能大于优惠抵扣总额
                const luckyCardInvalid = productInfo.exchangeType === cGoods.ExchangeType.LUCKY_CARD_EXCHANGE && hasValue && record.discountTotalAmount && value > record.discountTotalAmount;
                return (
                    <>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onChange={val => {
                                handleUpdateValue(val, 'settlementPrice', index);
                                // 同步计算平台运营成本，保持配平：会员价 - 供应商结算价 = 总佣金 + 平台运营成本
                                if (productInfo.exchangeType === cGoods.ExchangeType.LUCKY_CARD_EXCHANGE) {
                                    const _discountTotalAmount = Number(record.discountTotalAmount) || 0;
                                    const _settlementPrice = Number(val) || 0;
                                    const _platformProfit = uNumber.toFixed(_discountTotalAmount - _settlementPrice, 2);
                                    handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                } else {
                                    const _discountIntegral = uNumber.centToYuan(record.discountIntegral) || 0;
                                    const _payAmount = Number(record.payAmount) || 0;
                                    const _settlementPrice = Number(val) || 0;
                                    const _platformProfit = uNumber.toFixed(_discountIntegral + _payAmount - _settlementPrice, 2);
                                    handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                }
                            }}
                            onBlur={e => {
                                const value = e.target?.value || '';
                                handleUpdateValue(value, 'settlementPrice', index);
                                if (productInfo.exchangeType === cGoods.ExchangeType.LUCKY_CARD_EXCHANGE) {
                                    // 福卡兑换：修改结算价时，自动计算平台利润 = 优惠抵扣总额 - 结算价 - 服务费
                                    const _discountTotalAmount = Number(record.discountTotalAmount) || 0;
                                    const _settlementPrice = Number(value) || 0;
                                    // const _thirdPartyCommission = Number(record.thirdPartyCommission) || 0;
                                    // 福卡兑换没有总佣金，固定为0
                                    const _platformProfit = uNumber.toFixed(_discountTotalAmount - _settlementPrice, 2);
                                    handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                } else {
                                    // 非福卡兑换：修改结算价时，自动计算平台利润
                                    const _discountIntegral = uNumber.centToYuan(record.discountIntegral) || 0;
                                    const _payAmount = Number(record.payAmount) || 0;
                                    const _settlementPrice = Number(value) || 0;
                                    const _platformProfit = uNumber.toFixed(_discountIntegral + _payAmount - _settlementPrice, 2);
                                    handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                }
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于积分抵扣等值金额 + 支付金额
                            </div>
                        )}
                        {luckyCardInvalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于优惠抵扣总额（{record.discountTotalAmount} 元）
                            </div>
                        )}
                    </>
                );
            },
        },
        {
            title: '会员价',
            align: 'left',
            width: 100,
            dataIndex: 'memberPrice',
            render: text => text || 0,
        },
        {
            title: '零售价',
            align: 'left',
            width: 100,
            dataIndex: 'retailPrice',
            render: text => text || 0,
        },
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 100,
            dataIndex: 'thirdPartyCommission',
            render: _value =>
                // if (productInfo.exchangeType === cGoods.ExchangeType.LUCKY_CARD_EXCHANGE) {
                //     return value || 0;
                // }

                // 固定为0
                0,
        },
        ...(headerKey === headerKeysEnum.WELFARE_LOCAL_LIFE
            ? [
                  {
                      title: (
                          <Tooltip
                              title={
                                  <div>
                                      <span>中心仓配送费将从供应商结算价扣除</span>
                                      <p>供应商实际结算价 = 供应商结算价 - 仓储配送服务费</p>
                                  </div>
                              }
                          >
                              仓储配送服务费
                              <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                          </Tooltip>
                      ),
                      align: 'left' as const,
                      width: 160,
                      dataIndex: 'storageDeliveryFee',
                      render: (value: number, record: DataItemType, index: number) => {
                          const _settlementPrice = Number(record.settlementPrice) || 0;
                          // 供应商实际结算价 = 供应商结算价 - 仓储配送服务费
                          const _supplierSettlementPrice = uNumber.toFixed(_settlementPrice - value, 2);
                          /** 是否大于供应商结算价 */
                          const isMore = Number(value) >= _settlementPrice;
                          return (
                              <div>
                                  <InputNumber
                                      value={value}
                                      min={0}
                                      precision={2}
                                      disabled={!edit}
                                      style={{ width: '100px' }}
                                      placeholder="必填"
                                      onChange={e => {
                                          handleUpdateValue(e as number, 'storageDeliveryFee', index);
                                      }}
                                  />
                                  {_supplierSettlementPrice > 0 ? <div style={{ fontSize: '12px', marginTop: '2px' }}>供应商实际结算价：{_supplierSettlementPrice}</div> : null}
                                  {isMore && edit ? (
                                      <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                          <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                          需要小于供应商结算价
                                      </div>
                                  ) : null}
                              </div>
                          );
                      },
                  },
              ]
            : []),
        ...(headerKey === headerKeysEnum.WELFARE_LOCAL_LIFE
            ? []
            : [
                  {
                      title: '活动可售总数',
                      align: 'left' as const,
                      width: 130,
                      render: (_: unknown, record: DataItemType, index: number) => (
                          <div>
                              <InputNumber min={0} precision={0} value={record.limitNum || 0} onChange={e => handleUpdateValue(e || 0, 'limitNum', index)} />
                              <p>商品可售库存: {record.availNum || 0}</p>
                          </div>
                      ),
                  },
              ]),
        {
            title: '已兑换数量',
            align: 'left',
            width: 100,
            dataIndex: 'convertNum',
        },
        ...(productInfo.exchangeType === cGoods.ExchangeType.INTEGRAL_EXCHANGE
            ? [
                  ...(hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限'])
                      ? [
                            {
                                title: '平台运营成本',
                                align: 'left' as const,
                                width: 100,
                                dataIndex: 'platformProfit',
                                render: (_: unknown, record: DataItemType) =>
                                    // 平台运营成本 = (积分 + 金额) - 结算价
                                    uNumber.toFixed(uNumber.centToYuan(record.discountIntegral) + record.payAmount - record.settlementPrice, 2),
                            },
                        ]
                      : []),
                  {
                      title: '活动抵扣资产',
                      align: 'left' as const,
                      width: 300,
                      render: (_: unknown, record: DataItemType, index: number) => (
                          <div>
                              <InputNumber
                                  value={record.discountIntegral || 0}
                                  precision={0}
                                  min={1}
                                  disabled={!edit || isView}
                                  addonAfter="积分"
                                  style={{ width: '130px' }}
                                  onChange={e => {
                                      handleUpdateValue(e || 0, 'discountIntegral', index);

                                      // 修改抵扣积分时，自动计算平台运营成本
                                      const _discountIntegral = uNumber.centToYuan(Number(e || 0));
                                      const _payAmount = Number(record.payAmount) || 0;
                                      const _settlementPrice = record.settlementPrice || 0;

                                      const _platformProfit = uNumber.toFixed(_discountIntegral + _payAmount - _settlementPrice, 2);
                                      handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                  }}
                              />
                              +
                              <InputNumber
                                  value={record.payAmount || 0}
                                  min={0}
                                  disabled={!edit || record.settlementValue === 0 || isBenefitVirtualGoods}
                                  addonBefore="¥"
                                  style={{ width: '130px' }}
                                  onChange={e => {
                                      handleUpdateValue(e || 0, 'payAmount', index);

                                      // 修改抵扣积分时，自动计算平台运营成本
                                      const _discountIntegral = uNumber.centToYuan(record.discountIntegral);
                                      const _payAmount = Number(e) || 0;
                                      const _settlementPrice = record.settlementPrice || 0;

                                      const _platformProfit = uNumber.toFixed(_discountIntegral + _payAmount - _settlementPrice, 2);
                                      handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                  }}
                              />
                              <p style={{ textAlign: 'left' }}>
                                  {record.discountIntegral}积分等值¥{uNumber.centToYuan(record.discountIntegral)}
                              </p>
                          </div>
                      ),
                  },
                  {
                      title: '用户金额补差',
                      align: 'left' as const,
                      width: 160,
                      render: (_: unknown, record: DataItemType, index: number) => (
                          <div>
                              <Switch checked={record.isPriceSubsidy === 0 ? false : true} disabled={!edit || record.settlementValue === 0} onChange={e => handleUpdateValue(e ? 1 : 0, 'isPriceSubsidy', index)} />
                              {record.isPriceSubsidy === 0 ? null : (
                                  <div>
                                      起付积分
                                      <InputNumber
                                          min={1}
                                          max={record.discountIntegral || 1}
                                          precision={0}
                                          disabled={!edit}
                                          value={record.beginIntegral || 1}
                                          defaultValue={1}
                                          onChange={e => handleUpdateValue(e || 0, 'beginIntegral', index)}
                                      />
                                  </div>
                              )}
                          </div>
                      ),
                  },
              ]
            : [
                  // 这里是福卡需要的显示内容
                  ...(hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限'])
                      ? [
                            {
                                title: '平台运营成本',
                                align: 'left' as const,
                                width: 100,
                                dataIndex: 'platformProfit',
                                render: (_: unknown, record: DataItemType) =>
                                    // 平台利润 = 优惠抵扣总额 - 结算价 - 服务费(为0)
                                    uNumber.toFixed((record.discountTotalAmount || 0) - record.settlementPrice, 2),
                            },
                        ]
                      : []),
                  // 福卡混合抵扣开关
                  {
                      title: (
                          <span>
                              福卡混合抵扣
                              <Tooltip title="配置多种福卡兑换时，支持按需指定单种福卡数量，也可仅设置福卡总数量">
                                  <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'pointer' }} />
                              </Tooltip>
                          </span>
                      ),
                      align: 'left' as const,
                      width: 160,
                      render: (_: unknown, record: DataItemType, skuIndex: number) => (
                          <Switch
                              checked={record.isFlexibleExchange === 1}
                              disabled={!edit}
                              checkedChildren="支持"
                              unCheckedChildren="不支持"
                              onChange={checked => {
                                  handleUpdateValue(checked ? 1 : 0, 'isFlexibleExchange', skuIndex);
                              }}
                          />
                      ),
                  },
                  // 兑换所需福卡及数量
                  {
                      title: '兑换所需福卡及数量',
                      align: 'left' as const,
                      width: 420,
                      render: (_text: unknown, record: DataItemType, skuIndex: number) => ExchangeRequiredLuckyCardsRender(record, skuIndex),
                  },
                  {
                      title: (
                          <Tooltip title="兑换商品指定福卡不足时，可使用万能券替代指定福卡进行抵扣">
                              万能券抵扣
                              <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                          </Tooltip>
                      ),
                      align: 'left' as const,
                      width: 360,
                      render: (_: unknown, record: DataItemType, index: number) => UniversalCardDeductRender(record, index),
                  },
                  // 优惠抵扣总额
                  {
                      title: (
                          <span>
                              优惠抵扣总额
                              <Tooltip title="福卡抵扣的商品实际价值固定，不受商品零售价格调整影响">
                                  <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'pointer' }} />
                              </Tooltip>
                          </span>
                      ),
                      align: 'left' as const,
                      width: 160,
                      render: (_: unknown, record: DataItemType, skuIndex: number) => DiscountTotalAmountRender(record, skuIndex),
                  },
                  // 用户补差
                  {
                      title: (
                          <span>
                              用户补差
                              <Tooltip title="福卡数量不足时，支持用户使用会员积分补差兑换商品。补差积分计算公式：积分 =（福卡总价值 - 福卡总价值 ÷ 兑换所需福卡总数 × 用户抵扣福卡数）× 100">
                                  <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'pointer' }} />
                              </Tooltip>
                          </span>
                      ),
                      align: 'left' as const,
                      width: 280,
                      render: (_: unknown, record: DataItemType, skuIndex: number) => {
                          const cards = record.fuCards || [];
                          const isMixed = record.isFlexibleExchange === 1;
                          // 计算福卡单张价值（元，保留2位小数）
                          const totalCardCount = isMixed ? record.totalFuCardsRequired || 0 : cards.reduce((sum, card) => sum + (card.fuCardNum || 0), 0);
                          const singleCardValue = totalCardCount > 0 ? uNumber.toFixed((record.discountTotalAmount || 0) / totalCardCount, 2) : 0;
                          const isSingleCardValueZero = Number(singleCardValue) <= 0;
                          return (
                              <div>
                                  <Switch
                                      checked={record.isIntegralSupplementEnabled === 1}
                                      disabled={!edit}
                                      onChange={checked => {
                                          if (checked && isSingleCardValueZero) {
                                              message.warning('福卡单张价值小于0.01，不能打开用户补差');
                                              return;
                                          }
                                          handleUpdateValue(checked ? 1 : 0, 'isIntegralSupplementEnabled', skuIndex);
                                      }}
                                  />
                                  {record.isIntegralSupplementEnabled === 1 && cards.length > 0 && (
                                      <div style={{ marginTop: 8 }}>
                                          <div style={{ marginBottom: 4 }}>起付福卡数:</div>
                                          {/* 混合抵扣模式：统一输入起付卡总数量 */}
                                          {isMixed ? (
                                              <InputNumber
                                                  min={1}
                                                  max={record.totalFuCardsRequired ?? undefined}
                                                  value={record.minPayNum}
                                                  disabled={!edit}
                                                  placeholder="请输入"
                                                  onChange={value => {
                                                      handleUpdateValue(value || 0, 'minPayNum', skuIndex);
                                                  }}
                                                  addonAfter="张"
                                                  style={{ width: 110 }}
                                              />
                                          ) : (
                                              /* 非混合抵扣模式：每个福卡单独输入起付数量 */
                                              cards.map((card, cardIndex) => (
                                                  <div key={`begin-${record.skuId}-${cardIndex}`} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                                                      <Input disabled style={{ width: 120 }} value={card?.fuCardName || ''} />
                                                      <InputNumber
                                                          min={1}
                                                          max={card?.fuCardNum ?? undefined}
                                                          value={card?.minPayNum}
                                                          disabled={!edit}
                                                          placeholder="请输入"
                                                          onChange={value => {
                                                              const tableList = [...tableData];
                                                              const list = [...(tableList[skuIndex].fuCards || [])];
                                                              if (list[cardIndex]) {
                                                                  list[cardIndex] = { ...list[cardIndex], minPayNum: value || undefined };
                                                                  handleUpdateValue(list, 'fuCards', skuIndex);
                                                              }
                                                          }}
                                                          addonAfter="张"
                                                          style={{ width: 110, marginLeft: 8 }}
                                                      />
                                                  </div>
                                              ))
                                          )}
                                      </div>
                                  )}
                              </div>
                          );
                      },
                  },
              ]),
        {
            title: '活动商品限购',
            align: 'left',
            width: 160,
            render: (_: unknown, record: DataItemType, index: number) => (
                <div>
                    <InputNumber min={0} value={record.purchaseLimit || 0} precision={0} onChange={e => handleUpdateValue(e || 0, 'purchaseLimit', index)} />
                </div>
            ),
        },
        ...(headerKey === headerKeysEnum.WELFARE_LOCAL_LIFE
            ? [
                  {
                      title: (
                          <Tooltip title="设置预售提货天数后，用户看到的可提货日期为：当前日期+预售设置提货天数，如下单日期为7.24，预售可提货天数4天，则预计7.28可提货">
                              预售(天数)
                              <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                          </Tooltip>
                      ),
                      align: 'left' as const,
                      width: 200,
                      render: (_value: unknown, record: DataItemType, index: number) => PreSaleDaysRender(record, index),
                  },
                  {
                      title: '分仓时效',
                      width: 120,
                      dataIndex: 'warehouseDeliveryConfigs',
                      render: (value: WarehouseItem[], _record: DataItemType, index: number) => {
                          const isCustom = value?.some((item: WarehouseItem) => item.isCustom);
                          return (
                              <Button
                                  onClick={() => {
                                      setCurrentDeliveryTimeFrameSkuIndex(index);
                                      setDeliveryTimeFrameModalVisible(true);
                                  }}
                              >
                                  {value?.length && isCustom ? '已配置' : '配置分仓时效'}
                              </Button>
                          );
                      },
                  },
              ]
            : []),
        ...(headerKey === headerKeysEnum.WELFARE_TO_SHOP
            ? [
                  {
                      title: '商品发货编码',
                      align: 'left' as const,
                      width: 120,
                      dataIndex: 'supplierSkuCode',
                      render: (value: string) => <Input value={value} disabled style={{ width: '100px' }} />,
                  },
              ]
            : []),
    ];

    /** 福利商城-店铺自提sku设置 */
    const WelfareShopPickupGoodsTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 300,
            dataIndex: 'propertyValuesStr',
            render: (_value, record) => (
                <Flex align="center">
                    <Image width={60} height={60} src={record.propPicUrl} />
                    <span className="ml10" style={{ width: '230px' }}>
                        {record.skuDesc}
                    </span>
                </Flex>
            ),
        },
        {
            title: '结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (_value, record) => <span>{record.settlementPrice}</span>,
        },
        {
            title: '会员价(直播会员价)',
            align: 'left',
            width: 120,
            render: (_value, record) => {
                const { memberPrice } = calculatePrices(record);
                const isValid = memberPrice > 0;
                return (
                    <span style={{ color: isValid ? 'inherit' : '#ff4d4f' }}>
                        {uNumber.centToYuan(memberPrice)}
                        {!isValid && <ExclamationCircleOutlined style={{ marginLeft: '4px', color: '#ff4d4f' }} />}
                    </span>
                );
            },
        },
        {
            title: '零售价(直播售价)',
            align: 'left',
            width: 120,
            dataIndex: 'payAmount',
            render: (_value, record) => <span>{record.payAmount}</span>,
        },
        {
            title: '直播会员优惠',
            align: 'left',
            width: 120,
            dataIndex: 'commissionMoney',
            render: (_value, record) => <span>{record.commissionMoney}</span>,
        },
        {
            title: '活动可售总数',
            align: 'left',
            width: 130,
            render: (_value, record, index) => (
                <div>
                    <InputNumber min={0} precision={0} value={record.limitNum || 0} onChange={e => handleUpdateValue(e || 0, 'limitNum', index)} />
                    <p>商品可售库存: {record.availNum || 0}</p>
                </div>
            ),
        },
        {
            title: '已兑换数量',
            align: 'left',
            width: 100,
            dataIndex: 'convertNum',
        },
        {
            title: '平台预估服务费',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const discountTotalAmount = Number(record.discountTotalAmount) || 0;
                const platformServiceFee = uNumber.toFixed((discountTotalAmount * serviceFeeRate) / 100, 2);

                return (
                    <div>
                        <div>安选直播平台服务费比例: {serviceFeeRate}%</div>
                        <div>会员预估服务费: ¥{uNumber.centToYuan(platformServiceFee)}</div>
                        <div>用户预估服务费: ¥{uNumber.centToYuan(platformServiceFee)}</div>
                    </div>
                );
            },
        },
        {
            title: '门店预估结算价',
            align: 'left',
            width: 200,
            render: (_value, record) => {
                const discountTotalAmount = Number(record.discountTotalAmount) || 0;
                const platformServiceFee = Number(uNumber.toFixed((discountTotalAmount * serviceFeeRate) / 100, 2));
                const shopSettlementPrice = uNumber.toFixed(discountTotalAmount - platformServiceFee, 2);

                return (
                    <div>
                        <div>会员预估结算价: ¥{uNumber.centToYuan(shopSettlementPrice)}</div>
                        <div>用户预估结算价: ¥{uNumber.centToYuan(shopSettlementPrice)}</div>
                    </div>
                );
            },
        },
        {
            title: '跨店服务商预估利润',
            align: 'left',
            width: 200,
            render: () => (
                <div>
                    <div>店长核销预估利润: ¥0</div>
                    <div>用户核销预估利润: ¥0</div>
                </div>
            ),
        },
        // 福卡混合抵扣开关
        {
            title: (
                <span>
                    福卡混合抵扣
                    <Tooltip title="配置多种福卡兑换时，支持按需指定单种福卡数量，也可仅设置福卡总数量">
                        <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'pointer' }} />
                    </Tooltip>
                </span>
            ),
            align: 'left' as const,
            width: 160,
            render: (_: unknown, record: DataItemType, skuIndex: number) => (
                <Switch
                    checked={record.isFlexibleExchange === 1}
                    disabled={!edit}
                    checkedChildren="支持"
                    unCheckedChildren="不支持"
                    onChange={checked => {
                        handleUpdateValue(checked ? 1 : 0, 'isFlexibleExchange', skuIndex);
                    }}
                />
            ),
        },
        // 兑换所需福卡及数量
        {
            title: '兑换所需福卡及数量',
            align: 'left' as const,
            width: 420,
            render: (_text: unknown, record: DataItemType, skuIndex: number) => ExchangeRequiredLuckyCardsRender(record, skuIndex),
        },
        // 优惠抵扣总额
        {
            title: (
                <span>
                    优惠抵扣总额
                    <Tooltip title="福卡抵扣的商品实际价值固定，不受商品零售价格调整影响">
                        <QuestionCircleOutlined style={{ marginLeft: 4, cursor: 'pointer' }} />
                    </Tooltip>
                </span>
            ),
            align: 'left' as const,
            width: 160,
            render: (_: unknown, record: DataItemType, skuIndex: number) => DiscountTotalAmountRender(record, skuIndex),
        },

        {
            title: (
                <Tooltip title="兑换商品指定福卡不足时，可使用万能券替代指定福卡进行抵扣">
                    万能券抵扣
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left' as const,
            width: 360,
            render: (_: unknown, record: DataItemType, index: number) => UniversalCardDeductRender(record, index),
        },
        {
            title: '活动商品限购',
            align: 'left',
            width: 160,
            render: (_: unknown, record: DataItemType, index: number) => (
                <div>
                    <InputNumber min={0} value={record.purchaseLimit || 0} precision={0} onChange={e => handleUpdateValue(e || 0, 'purchaseLimit', index)} />
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="设置预售提货天数后，用户看到的可提货日期为：当前日期+预售设置提货天数，如下单日期为7.24，预售可提货天数4天，则预计7.28可提货">
                    预售(天数)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 200,
            render: (_value, record, index) => PreSaleDaysRender(record, index),
        },
    ];

    /** 众筹商品库 */
    const crowdFundingActiveGoodsTableColumn: TableProps<DataItemType>['columns'] = [
        {
            title: SkuStatusHeaderRender('商品状态'),
            align: 'left',
            width: 100,
            dataIndex: 'isHide',
            render: (value, _record, index) => <Switch checked={value === 0} onChange={checked => handleUpdateValue(checked ? 0 : 1, 'isHide', index)} disabled={isView} />,
        },
        {
            title: '供应链商品库状态',
            align: 'left',
            width: 140,
            dataIndex: 'baseSkuIsHide',
            render: (value, _record) => <Switch checked={value === 0} disabled />,
        },
        {
            title: '规格',
            align: 'left',
            width: 150,
            dataIndex: 'skuDesc',
            render: value => <span>{value}</span>,
        },
        {
            title: '规格图片',
            align: 'left',
            width: 100,
            dataIndex: 'propPicUrl',
            render: value => <Image width={60} height={60} src={value} />,
        },
        {
            title: '增值税税率',
            dataIndex: 'supplierTaxRate',
            key: 'supplierTaxRate',
            hidden: headerKey !== headerKeysEnum.BENEFIT_GOODS,
            width: 120,
            render: (val: number) => (val !== undefined && val !== null ? `${(val * 100).toFixed(2)}%` : '--'),
        },
        {
            title: '供应商结算价',
            align: 'left',
            width: 120,
            dataIndex: 'settlementPrice',
            render: (value, record, index) => {
                const hasMember = record.memberPrice !== undefined && record.memberPrice !== null;
                const hasValue = value !== undefined && value !== null;
                const invalid = hasValue && hasMember && (value as number) > (record.memberPrice as number);
                return (
                    <div>
                        <InputNumber
                            value={value}
                            min={0}
                            precision={2}
                            disabled={!edit || isView}
                            style={{ width: '100px' }}
                            placeholder="必填"
                            onBlur={e => {
                                const value = e.target?.value || '';
                                handleUpdateValue(value, 'settlementPrice', index);
                                // 修改结算价时，自动计算总佣金和平台运营成本
                                const _settlementPrice = Number(value) || 0;
                                const _memberPrice = Number(record.memberPrice) || 0;
                                const _platformProfit = handleCalcPlatformProfit(record);
                                const _serviceFee = uNumber.toFixed(_memberPrice - _settlementPrice - _platformProfit, 2);
                                handleUpdateValue(_platformProfit as number, 'platformProfit', index);
                                handleUpdateValue(_serviceFee as number, 'thirdPartyCommission', index);
                                // 更新推广服务费(服务商)
                                handleUpdateValue(mathFloor((_serviceFee * Number(record.goodsMarketingProfitRate)) / 100, 2), 'goodsMarketingProfit', index);
                            }}
                        />
                        {invalid && edit && (
                            <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                不能大于会员价
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            title: '众筹会员价',
            align: 'left',
            width: 160,
            dataIndex: 'memberPrice',
            render: (value, record, index) => memberPriceFieldRender(value, record, index, 'retailPrice'),
        },
        {
            title: '众筹零售价',
            dataIndex: 'retailPrice',
            key: 'retailPrice',
            align: 'left',
            width: 100,
            render: (value, record, index) => retailPriceFieldRender(value, record, index, 'retailPrice'),
        },
        ...(() => {
            const platformProfitColumn: TableProps<DataItemType>['columns'] = [
                {
                    title: (
                        <Tooltip title="平台运营成本 = 会员价 * 5%">
                            平台运营成本
                            <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                        </Tooltip>
                    ),
                    align: 'left',
                    dataIndex: 'platformProfit',
                    key: 'platformProfit',
                    width: 130,
                    render: (value, record, index) => {
                        // 平台运营成本 = 会员价 * 5%
                        const _value = value < 0 ? handleCalcPlatformProfit(record) : value;
                        // 注意：不在 render 中直接调用 handleUpdatePlatformProfit（setState），避免 React "Too many re-renders" 崩溃
                        return (
                            <div>
                                <InputNumber
                                    value={_value}
                                    min={0}
                                    precision={2}
                                    disabled={!edit || isView || !hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])}
                                    style={{ width: '100px' }}
                                    placeholder="必填"
                                    onChange={e => handleUpdatePlatformProfit(e as number, record, index)}
                                />
                                {_value < 0 && edit && (
                                    <div style={{ color: '#ff4d4f', fontSize: '12px', marginTop: '2px' }}>
                                        <ExclamationCircleOutlined style={{ marginRight: '4px' }} />
                                        平台运营成本为负
                                    </div>
                                )}
                            </div>
                        );
                    },
                },
            ];
            return hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限']) ? platformProfitColumn : [];
        })(),
        {
            title: (
                <Tooltip title="总佣金=会员价-供应商结算价-平台运营成本，举例：100-80-5=15元">
                    总佣金
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'thirdPartyCommission',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    <InputNumber
                        style={{ width: 80, marginRight: 8 }}
                        min={0}
                        max={priceMax}
                        disabled
                        precision={2}
                        value={record.thirdPartyCommission}
                        placeholder="请输入"
                        onChange={e => handleUpdateValue(e as number, 'thirdPartyCommission', index)}
                    />
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="推广服务费(服务商)=总佣金*佣金比例%，默认比例50%，比例浮动33%～66%，举例：15*50%=7.5元">
                    推广服务费(服务商)
                    <QuestionCircleOutlined style={{ marginLeft: '6px' }} />
                </Tooltip>
            ),
            align: 'left',
            width: 180,
            dataIndex: 'goodsMarketingProfitRate',
            render: (_text, record, index) => (
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                    {/* <Select
                        value={record.goodsProfitRateCode}
                        style={{
                            minWidth: '100px',
                            maxWidth: '140px',
                            marginRight: '6px',
                        }}
                        disabled={!edit}
                        showSearch
                        filterOption={false}
                        onSearch={debounceProfitFetcher}
                        onChange={val => handleUpdateValue(val, 'goodsProfitRateCode', index)}
                    >
                        {profitList.map(item => (
                            <Select.Option key={item.code} value={item.code}>{item.name}</Select.Option>
                        ))}
                    </Select> */}
                    <InputNumber style={{ width: 100, marginRight: 8 }} precision={0} min={record.isValuableGoods ? 0 : 33} max={record.isValuableGoods ? 100 : 66} disabled value={_text} placeholder="请输入" addonAfter="%" />
                    <InputNumber
                        style={{ width: 100, marginRight: 8 }}
                        precision={2}
                        min={0}
                        disabled={!hasPriceEditPermission()}
                        value={record.goodsMarketingProfit}
                        placeholder="请输入"
                        onBlur={e => {
                            const val = e.target.value;
                            if (val !== '' && val != null) {
                                handleUpdateValue(+val, 'goodsMarketingProfit', index);
                            }
                        }}
                        onPressEnter={e => {
                            const val = (e.target as HTMLInputElement).value;
                            if (val !== '' && val != null) {
                                const newProfit = +val;
                                handleUpdateValue(+newProfit, 'goodsMarketingProfit', index);
                            }
                        }}
                    />
                </div>
            ),
        },
        ...getDeliveryCommonColumns(),
        {
            title: getSupplierSkuCodeTitle(),
            align: 'left',
            width: 120,
            dataIndex: 'supplierSkuCode',
            render: (value, _record, index) => (
                <Input
                    value={value}
                    // disabled={!edit}
                    disabled
                    style={{ width: '100px' }}
                    placeholder="必填"
                    onChange={e => handleUpdateValue(e.target.value, 'supplierSkuCode', index)}
                />
            ),
        },
    ];

    const handleTagOk = async (value: string) => {
        // const params = {
        //     spuId: productInfo.spuId,
        //     skuIds,
        //     deliveryLabel: value,
        // };
        // try {
        //     const res = await hRequest.api.GoodsDetailManage.deliveryLabelBatchUpdate(params, { noHandle: true });
        //     if (res.code !== FQFetchEnums.JsonSuccessCode.Success) {
        //         hPrompt.errorMessage(res.msg as unknown as string);
        //         return;
        //     }
        //     hPrompt.successMessage('操作成功');
        //     // propertyDataList.map(v => {
        //     //     skuIds.map(skuId => {
        //     //         if (v.skuId === skuId) {
        //     //             v.deliveryLabel = value;
        //     //         }
        //     //     });
        //     //     return v;
        //     // });
        //     // setPropertyDataList(propertyDataList);
        //     handleTagCancel();
        // } catch (error) { }
        if (sDataItemType) {
            sDataItemType.deliveryLabel = value;
            handleResetTableData();
            handleTagCancel();
        }
    };

    const handleGetColumn = () => {
        switch (headerKey) {
            case headerKeysEnum.AN_XUAN_GOODS_SHELVES:
                return shelvedTableColumn;
            case headerKeysEnum.AN_XUAN_CLOUD_TO_SHOP:
                return anxuanCloudToShopTableColumn;
            case headerKeysEnum.AN_XUAN:
                return anxuanTableColumn;
            case headerKeysEnum.BATCH_GOODS:
            case headerKeysEnum.BATCH_STORE_GOODS:
                return batchTableColumn;
            case headerKeysEnum.COMMUNITY_GROUP:
            case headerKeysEnum.WAREHOUSE_TO_STORE:
                return communityTableColumn;
            case headerKeysEnum.INTERNAL_PURCHASE:
                return internalPurchaseTableColumn;
            case headerKeysEnum.INTEGRAL_GOODS:
            case headerKeysEnum.WELFARE_LOCAL_LIFE:
            case headerKeysEnum.WELFARE_TO_SHOP:
                return IntegralGoodsTableColumn;
            case headerKeysEnum.WELFARE_SHOP_PICKUP:
                return WelfareShopPickupGoodsTableColumn;
            case headerKeysEnum.CROWD_FUNDING_ACTIVE_GOODS:
                return crowdFundingActiveGoodsTableColumn;
            default:
                return NormalTableColumn;
        }
    };

    // 批量设置多规格商品属性
    const handleModify = () => {
        switch (modifyType) {
            case 'settlementPrice':
            case 'thirdPartyCommission':
            case 'retailPrice':
            case 'memberPrice':
            case 'payAmount':
            case 'communityGroupCommission':
            case 'discountIntegral':
                if (modifyValue) {
                    handleUpdateValue(modifyValue, modifyType, -1);
                }
                break;
            case 'platformProfit':
                if (modifyValue) {
                    // 批量设置平台运营成本，逐个 SKU 校验 max 值并联动更新
                    tableData.forEach((record, index) => {
                        handleUpdatePlatformProfit(modifyValue, record, index);
                    });
                }
                break;
            case 'goodsMarketingProfit':
                if (modifyValue) {
                    handleUpdateValue(modifyValue, modifyType, -1);
                }
                break;
            case 'shopCommissionIntegral':
                if (modifyShopCommissionIntegralMode === 'point') {
                    handleUpdateValue(modifyShopCommissionIntegral, 'shopCommissionIntegral', -1);
                } else {
                    handleUpdateValue(modifyShopCommissionIntegralRate, 'shopCommissionIntegralRate', -1);
                }
                break;
            case 'syncPriceSwitch':
                handleUpdateValue(modifySyncPriceSwitch, 'syncPriceSwitch', -1);
                break;
            default:
        }
        handleBatchModalCancel();
    };

    // 多规格设置title
    const getLabel = () => {
        let res = '';
        switch (modifyType) {
            case 'settlementPrice':
                res = '结算价';
                break;
            case 'thirdPartyCommission':
                res = '总佣金';
                break;
            case 'retailPrice':
                res = '零售价';
                break;
            case 'memberPrice':
                res = '会员价';
                break;
            case 'payAmount':
                res = '零售价';
                break;
            case 'communityGroupCommission':
                res = '总佣金';
                break;
            case 'shopCommissionIntegral':
                res = '会员返积分';
                break;
            case 'discountIntegral':
                res = '设置统一兑换积分';
                break;
            case 'platformProfit':
                res = '平台运营成本';
                break;
            case 'goodsMarketingProfit':
                res = '推广服务费';
                break;
            default:
        }
        return res;
    };

    // 批量弹框取消
    const handleBatchModalCancel = () => {
        setBactchModalVisible(false);
        setModifyType('');
        setModifyValue(undefined);
        setModifyShopCommissionIntegral(0);
        setModifyShopCommissionIntegralRate(0);
    };

    // 批量设置多规格数据
    const handleBatchSetValue = (key: string) => {
        setModifyType(key);
        setBactchModalVisible(true);
    };

    // 批量设置的弹窗
    const renderBatchModifyModal = (
        <Modal title={getLabel()} open={bactchModalVisible} onOk={handleModify} onCancel={handleBatchModalCancel}>
            <Form>
                {['settlementPrice', 'thirdPartyCommission', 'retailPrice', 'memberPrice', 'payAmount', 'communityGroupCommission', 'discountIntegral', 'platformProfit', 'goodsMarketingProfit'].includes(modifyType) && (
                    <Form.Item label={getLabel()}>
                        <InputNumber
                            placeholder="请输入"
                            value={modifyValue}
                            style={{ width: 300 }}
                            min={0}
                            max={99999999999}
                            onChange={val => {
                                setModifyValue(val || 0);
                            }}
                        />
                    </Form.Item>
                )}
                {modifyType === 'shopCommissionIntegral' && (
                    <Form.Item label="会员返积分">
                        <Select style={{ width: 120, marginRight: 8 }} value={modifyShopCommissionIntegralMode} onChange={val => setModifyShopCommissionIntegralMode(val)}>
                            <Select.Option value="rate">按比例</Select.Option>
                            <Select.Option value="point">按积分</Select.Option>
                        </Select>
                        {modifyShopCommissionIntegralMode === 'rate' ? (
                            <InputNumber
                                style={{ width: 180 }}
                                min={0}
                                precision={2}
                                value={modifyShopCommissionIntegralRate}
                                placeholder="请输入比例"
                                formatter={v => (v === undefined || v === null ? '' : `${v}%`)}
                                parser={v => (v ? Number(String(v).replace('%', '')) : 0)}
                                onChange={val => setModifyShopCommissionIntegralRate(Number(val || 0))}
                            />
                        ) : (
                            <InputNumber style={{ width: 180 }} min={0} precision={0} value={modifyShopCommissionIntegral} placeholder="请输入积分值" onChange={val => setModifyShopCommissionIntegral(Number(val || 0))} />
                        )}
                    </Form.Item>
                )}
                {modifyType === 'syncPriceSwitch' && (
                    <Form.Item label="会员价零售价同价">
                        <Switch checked={modifySyncPriceSwitch === 1} onChange={val => setModifySyncPriceSwitch(val ? 1 : 0)} />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    );

    // 结算价批量设置按钮显示条件
    const getIsShowSettlementPriceBatchButton = () => {
        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return false;

        // 福利商城商品
        if (isIntegralGoods) return false;

        return true;
    };

    // 会员价批量设置按钮显示条件
    const getIsShowMemberPriceBatchButton = () => {
        // 团批场景，需要有价格调整权限
        const isBatchNoPermission = batchHeaderKeys.includes(headerKey) && !hasPriceEditPermission();
        if (isBatchNoPermission) return false;

        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return false;

        // 福利商城商品
        if (isIntegralGoods) return false;

        // 内购商品
        if (headerKey === headerKeysEnum.INTERNAL_PURCHASE) return false;

        return true;
    };

    // 零售价(payAmount)批量设置按钮显示条件
    const getIsShowPayAmountPriceBatchButton = () => {
        // 团批
        if (batchHeaderKeys.includes(headerKey)) return false;

        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return true;

        // 安选货架商品
        if (headerKey === headerKeysEnum.AN_XUAN_GOODS_SHELVES) return true;

        // 社区团购商品
        if (communityGroupHeaderKeys.includes(headerKey)) return true;

        return false;
    };

    // 零售价(retailPrice)批量设置按钮的条件
    const getIsShowRetailPriceBatchButton = () => {
        // 团批
        if (batchHeaderKeys.includes(headerKey)) return false;

        if (isIntegralGoods) return false;

        if (getIsShowPayAmountPriceBatchButton()) return false;

        return true;
    };

    // 总佣金批量设置按钮的条件
    const getIsShowThirdPartyCommissionBatchButton = () => {
        // 福利商城商品
        if (isIntegralGoods) return false;

        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return false;

        // 安选货架商品
        if (headerKey === headerKeysEnum.AN_XUAN_GOODS_SHELVES) return false;

        // 社区团购商品
        if (communityGroupHeaderKeys.includes(headerKey)) return false;

        return true;
    };

    // 会员价零售价同价批量设置按钮的条件
    const getIsShowSyncPriceSwitchBatchButton = () => {
        // 团批商品
        if (batchHeaderKeys.includes(headerKey)) return false;

        // 安选直播商品
        if (headerKey === headerKeysEnum.AN_XUAN) return false;

        // 安选货架商品
        if (headerKey === headerKeysEnum.AN_XUAN_GOODS_SHELVES) return false;

        // 福利商城商品
        if (isIntegralGoods) return false;

        // 内购商品
        if (headerKey === headerKeysEnum.INTERNAL_PURCHASE) return false;

        return true;
    };

    // 平台运营成本批量设置按钮的条件 - 和会员价的一样
    const getIsShowPlatformProfitBatchButton = () => {
        // 无平台运营成本可见权限
        if (!hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本可见权限'])) return false;
        // 无平台运营成本编辑权限
        if (!hUser.hasPermission(FQAuthEnums['商品管理-平台运营成本编辑权限'])) return false;

        // 无价格调整权限
        if (!hasPriceEditPermission()) return false;

        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return false;

        // 福利商城商品
        if (isIntegralGoods) return false;

        // 内购商品
        if (headerKey === headerKeysEnum.INTERNAL_PURCHASE) return false;

        return true;
    };

    // 推广服务费批量设置按钮的条件 - 和总佣金的一样
    const getIsShowGoodsMarketingProfitBatchButton = () => {
        // 无价格调整权限
        if (!hasPriceEditPermission()) return false;

        // 团批商品
        if (batchHeaderKeys.includes(headerKey)) return false;

        // 福利商城商品
        if (isIntegralGoods) return false;

        // 安选自提商品
        if (headerKey === headerKeysEnum.AN_XUAN && productInfo?.performance === performanceMap?.offlineGoodsSelfPickup) return false;

        // 安选货架商品
        if (headerKey === headerKeysEnum.AN_XUAN_GOODS_SHELVES) return false;

        // 社区团购商品
        if (communityGroupHeaderKeys.includes(headerKey)) return false;

        // 一件到发到店商品
        if (headerKey === headerKeysEnum.AN_XUAN_CLOUD_TO_SHOP) return false;

        return true;
    };

    return (
        <>
            <Table dataSource={tableData} columns={handleGetColumn()} rowKey="skuId" scroll={{ x: 'max-content' }} pagination={false} className="mt10" />
            {!isIntegralCardExchangeGoods && (
                <Row align="middle">
                    <span className="mr10">共{tableData.length}个规格，批量设置</span>
                    {getIsShowSettlementPriceBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('settlementPrice')}>
                            结算价
                        </Button>
                    )}
                    {getIsShowMemberPriceBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('memberPrice')}>
                            会员价
                        </Button>
                    )}
                    {getIsShowPayAmountPriceBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('payAmount')}>
                            零售价
                        </Button>
                    )}
                    {getIsShowRetailPriceBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('retailPrice')}>
                            零售价
                        </Button>
                    )}
                    {/* 业务库的总佣金字段都disable了，所以批量设置总佣金按钮注释掉 */}
                    {/* {
                            communityGroupHeaderKeys.includes(headerKey) && (
                                <Button
                                    type='link'
                                    disabled={!edit}
                                    onClick={() => handleBatchSetValue('communityGroupCommission')}
                                >
                                    总佣金
                                </Button>
                            )
                        }
                        {
                            getIsShowThirdPartyCommissionBatchButton() && (
                                <Button
                                    type='link'
                                    disabled={!edit}
                                    onClick={() => handleBatchSetValue('thirdPartyCommission')}
                                >
                                    总佣金
                                </Button>
                            )
                        } */}
                    {isIntegralGoods && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('discountIntegral')}>
                            积分抵扣配置
                        </Button>
                    )}
                    {getIsShowSyncPriceSwitchBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('syncPriceSwitch')}>
                            会员价零售价同价
                        </Button>
                    )}
                    {getIsShowPlatformProfitBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('platformProfit')}>
                            平台运营成本
                        </Button>
                    )}
                    {getIsShowGoodsMarketingProfitBatchButton() && (
                        <Button type="link" disabled={!edit} onClick={() => handleBatchSetValue('goodsMarketingProfit')}>
                            推广服务费
                        </Button>
                    )}
                </Row>
            )}
            {/* 福卡兑换商品批量设置 */}
            {isIntegralCardExchangeGoods && (
                <Row align="middle">
                    <span className="mr10">共{tableData.length}个规格，批量设置</span>
                    <Button type="link" disabled={!edit} onClick={handleOpenBatchLuckyCardModal}>
                        福卡抵扣配置
                    </Button>
                </Row>
            )}
            {tagModalVisible && (
                <GoodsTagModal
                    // deliveryLabel={skuIds.length > 1 ? '' : propertyDataList?.find(v => v.skuId === skuIds[0])?.deliveryLabel ?? ''}
                    deliveryLabel={sDataItemType?.deliveryLabel || ''}
                    visible={tagModalVisible}
                    onOk={handleTagOk}
                    onCancel={handleTagCancel}
                />
            )}
            {renderBatchModifyModal}

            {/* 福卡选择弹窗 */}
            <SelectPrizeModal
                visible={showSelectPrizeModal}
                onCancel={() => {
                    setShowSelectPrizeModal(false);
                    setCurrentSkuIndex(-1);
                }}
                onOk={handlePrizeSelected}
                defaultCards={currentSkuIndex >= 0 ? tableData[currentSkuIndex]?.fuCards || [] : []}
                isMixedDeduction={currentSkuIndex >= 0 && tableData[currentSkuIndex]?.isFlexibleExchange === 1}
                defaultTotalFuCardsRequired={currentSkuIndex >= 0 ? tableData[currentSkuIndex]?.totalFuCardsRequired : undefined}
            />

            {/* 查看福卡弹窗（只读） */}
            <Modal
                title="查看福卡"
                open={showViewPrizeModal}
                onCancel={() => {
                    setShowViewPrizeModal(false);
                    setCurrentViewSkuIndex(-1);
                }}
                footer={null}
                width={900}
            >
                {currentViewSkuIndex >= 0 && tableData[currentViewSkuIndex]?.fuCards?.length ? (
                    <>
                        <Table
                            pagination={false}
                            bordered
                            size="small"
                            rowKey={record => `${record.fuCardId || ''}-${record.id || ''}`}
                            dataSource={tableData[currentViewSkuIndex]?.fuCards || []}
                            columns={[
                                {
                                    title: '福卡名称',
                                    dataIndex: 'fuCardName',
                                    align: 'center',
                                },
                                {
                                    title: '福卡ID',
                                    dataIndex: 'fuCardId',
                                    align: 'center',
                                },
                                {
                                    title: '福卡说明',
                                    dataIndex: 'fuCardSpec',
                                    align: 'center',
                                },
                                {
                                    title: '福卡备注',
                                    dataIndex: 'fuCardRemark',
                                    align: 'center',
                                },
                                {
                                    title: '福卡图片',
                                    dataIndex: 'fuCardImage',
                                    align: 'center',
                                    render: (text: string) => <Image src={text || ''} width={50} height={50} />,
                                },
                                {
                                    title: '所需数量',
                                    dataIndex: 'fuCardNum',
                                    align: 'center',
                                    render: (value: number, row: LuckyCardSelectInfo) => {
                                        const isMixed = tableData[currentViewSkuIndex]?.isFlexibleExchange === 1;
                                        const mixedTotal = tableData[currentViewSkuIndex]?.totalFuCardsRequired || 0;
                                        return isMixed ? mixedTotal : value || row?.fuCardNum || 0;
                                    },
                                },
                            ]}
                        />
                        {tableData[currentViewSkuIndex]?.isFlexibleExchange === 1 && <div style={{ marginTop: 12, color: '#666' }}>总数量: {tableData[currentViewSkuIndex]?.totalFuCardsRequired || 0} 张</div>}
                    </>
                ) : (
                    <div>暂无福卡信息</div>
                )}
            </Modal>

            {/* 批量设置福卡弹窗 */}
            <Modal
                title="批量设置福卡抵扣配置"
                open={showBatchLuckyCardModal}
                onCancel={() => {
                    setShowBatchLuckyCardModal(false);
                    setBatchLuckyCards([]);
                    setBatchLuckyCardMixedDeduction(0);
                    setBatchTotalFuCardsRequired(1);
                    // 重置 ref
                    batchLuckyCardsRef.current = [];
                    batchLuckyCardMixedDeductionRef.current = 0;
                    batchTotalFuCardsRequiredRef.current = 1;
                }}
                onOk={handleBatchLuckyCardConfirm}
                maskClosable={false}
            >
                <Form>
                    <Form.Item label="福卡混合抵扣">
                        <Switch
                            checked={batchLuckyCardMixedDeduction === 1}
                            disabled={!edit}
                            checkedChildren="支持"
                            unCheckedChildren="不支持"
                            onChange={checked => {
                                const value = checked ? 1 : 0;
                                setBatchLuckyCardMixedDeduction(value);
                                batchLuckyCardMixedDeductionRef.current = value;
                            }}
                        />
                    </Form.Item>
                    <Form.Item label="兑换所需福卡">
                        <Button onClick={() => setShowBatchSelectPrizeModal(true)}>{batchLuckyCards.length > 0 ? '重新选择福卡' : '选择福卡'}</Button>
                        {batchLuckyCards.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {batchLuckyCards.map((card, index) => (
                                        <span
                                            key={index}
                                            style={{
                                                padding: '2px 8px',
                                                background: '#f5f5f5',
                                                borderRadius: 4,
                                            }}
                                        >
                                            {card?.fuCardName}
                                            {batchLuckyCardMixedDeduction !== 1 && ` × ${card?.fuCardNum || 1}`}
                                        </span>
                                    ))}
                                </div>
                                {batchLuckyCardMixedDeduction === 1 && batchLuckyCards.length > 0 && <div style={{ marginTop: 4, color: '#666' }}>总数量: {batchTotalFuCardsRequired} 张</div>}
                            </div>
                        )}
                    </Form.Item>
                </Form>
            </Modal>

            {/* 批量设置时的福卡选择弹窗 */}
            {showBatchSelectPrizeModal && (
                <SelectPrizeModal
                    visible={showBatchSelectPrizeModal}
                    onCancel={() => setShowBatchSelectPrizeModal(false)}
                    onOk={(cards, totalFuCardsRequired) => {
                        setBatchLuckyCards(cards);
                        // 同步更新 ref
                        batchLuckyCardsRef.current = cards;
                        // 混合抵扣模式下更新总数量
                        if (totalFuCardsRequired !== undefined) {
                            setBatchTotalFuCardsRequired(totalFuCardsRequired);
                            batchTotalFuCardsRequiredRef.current = totalFuCardsRequired;
                        }
                        setShowBatchSelectPrizeModal(false);
                    }}
                    defaultCards={batchLuckyCards}
                    isMixedDeduction={batchLuckyCardMixedDeduction === 1}
                    defaultTotalFuCardsRequired={batchTotalFuCardsRequired}
                />
            )}
            {/* 分仓时效配置弹窗 */}
            <DeliveryTimeFrameModal
                visible={deliveryTimeFrameModalVisible}
                skuInfo={
                    currentDeliveryTimeFrameSkuIndex >= 0
                        ? {
                              skuName: tableData[currentDeliveryTimeFrameSkuIndex]?.skuDesc ?? '',
                              salesStatus: tableData[currentDeliveryTimeFrameSkuIndex]?.salesStatus ?? 0,
                              goodsDeliveryAgeing: tableData[currentDeliveryTimeFrameSkuIndex]?.goodsDeliveryAgeing ?? undefined,
                          }
                        : undefined
                }
                initialConfigs={currentDeliveryTimeFrameSkuIndex >= 0 ? tableData[currentDeliveryTimeFrameSkuIndex]?.warehouseDeliveryConfigs || [] : []}
                warehouseList={warehouseList.filter(w => selectedWarehouseIds.includes(w.warehouseId))}
                isView={isView}
                onCancel={() => {
                    setDeliveryTimeFrameModalVisible(false);
                    setCurrentDeliveryTimeFrameSkuIndex(-1);
                }}
                onOk={configs => {
                    if (currentDeliveryTimeFrameSkuIndex >= 0) {
                        handleUpdateValue(configs as unknown as unknown[], 'warehouseDeliveryConfigs', currentDeliveryTimeFrameSkuIndex);
                    }
                    setDeliveryTimeFrameModalVisible(false);
                    setCurrentDeliveryTimeFrameSkuIndex(-1);
                }}
            />
        </>
    );
};

export default Index;
