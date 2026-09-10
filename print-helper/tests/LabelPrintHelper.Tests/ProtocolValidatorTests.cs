using System.Text.Json.Nodes;
using LabelPrintHelper.Protocol;

namespace LabelPrintHelper.Tests;

public sealed class ProtocolValidatorTests
{
    [Fact]
    public void DeserializeAndValidateManifest_AcceptsCanonicalManifest()
    {
        var manifest = ProtocolValidator.DeserializeAndValidateManifest(CreateManifest());
        Assert.Equal(1, manifest.ProtocolVersion);
        Assert.Single(Assert.IsAssignableFrom<IReadOnlyList<PrintAssetUpload>>(manifest.Assets));
    }

    [Theory]
    [InlineData("protocolVersion")]
    [InlineData("jobId")]
    [InlineData("createdAtUtc")]
    [InlineData("websiteVersion")]
    [InlineData("printerId")]
    [InlineData("printerName")]
    [InlineData("profileId")]
    [InlineData("printerProfileVersion")]
    [InlineData("widthMm")]
    [InlineData("heightMm")]
    [InlineData("widthDots")]
    [InlineData("heightDots")]
    [InlineData("layout")]
    [InlineData("range")]
    [InlineData("copies")]
    [InlineData("collate")]
    [InlineData("horizontalOffsetMm")]
    [InlineData("verticalOffsetMm")]
    [InlineData("threshold")]
    [InlineData("expectedLabels")]
    [InlineData("assets")]
    [InlineData("sequence")]
    public void DeserializeAndValidateManifest_RejectsEveryMissingRootField(string field) =>
        AssertRequired(() => Mutate(root => root.Remove(field)));

    [Theory]
    [InlineData("range", "from")]
    [InlineData("range", "to")]
    [InlineData("threshold", "mode")]
    [InlineData("assets", "assetId")]
    [InlineData("assets", "labelId")]
    [InlineData("assets", "widthDots")]
    [InlineData("assets", "heightDots")]
    [InlineData("assets", "rotation")]
    [InlineData("assets", "pngBase64")]
    [InlineData("assets", "sha256")]
    [InlineData("sequence", "ordinal")]
    [InlineData("sequence", "assetId")]
    [InlineData("sequence", "labelId")]
    [InlineData("sequence", "sourcePageNumber")]
    [InlineData("sequence", "copyNumber")]
    public void DeserializeAndValidateManifest_RejectsEveryMissingNestedField(string layer, string field) =>
        AssertRequired(() => Mutate(root => RemoveNested(root, layer, field)));

    [Fact]
    public void DeserializeAndValidateManifest_RejectsUnknownFieldsAtEveryLayer()
    {
        AssertUnsupported(root => root["unexpected"] = true);
        AssertUnsupported(root => root["range"]!.AsObject()["unexpected"] = true);
        AssertUnsupported(root => root["threshold"]!.AsObject()["unexpected"] = true);
        AssertUnsupported(root => root["assets"]!.AsArray()[0]!.AsObject()["unexpected"] = true);
        AssertUnsupported(root => root["sequence"]!.AsArray()[0]!.AsObject()["unexpected"] = true);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsWrongGeometryAndProtocol()
    {
        Assert.Equal("打印任务必须使用 XP-420B 100 × 75 mm 配置", Assert.Throws<ProtocolValidationException>(
            () => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["widthDots"] = 799))).Message);
        Assert.Equal("不支持的打印协议版本", Assert.Throws<ProtocolValidationException>(
            () => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["protocolVersion"] = 2))).Message);
    }

    [Theory]
    [InlineData("2026-01-01Z")]
    [InlineData("2026-02-30T00:00:00Z")]
    [InlineData("2026-09-08T00:00:00+08:00")]
    public void DeserializeAndValidateManifest_RejectsInvalidUtc(string timestamp) =>
        Assert.Equal("创建时间必须是有效的 UTC 日期时间", Assert.Throws<ProtocolValidationException>(
            () => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["createdAtUtc"] = timestamp))).Message);

    [Fact]
    public void DeserializeAndValidateManifest_AcceptsArbitrarilyPreciseUtcFraction() =>
        Assert.Equal("2026-09-08T00:00:00.12345678901234567890Z", ProtocolValidator.DeserializeAndValidateManifest(
            Mutate(root => root["createdAtUtc"] = "2026-09-08T00:00:00.12345678901234567890Z")).CreatedAtUtc);

    [Fact]
    public void DeserializeAndValidateManifest_EnforcesThresholdOneOf()
    {
        Assert.Equal("仅自定义阈值模式可设置阈值", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["threshold"] = JsonNode.Parse("{\"mode\":\"auto\",\"value\":null}")))).Message);
        Assert.Equal("自定义阈值必须在 0–255 之间", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["threshold"] = JsonNode.Parse("{\"mode\":\"custom\",\"value\":null}")))).Message);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("true")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("null")]
    public void DeserializeAndValidateManifest_RejectsNonStringThresholdModesWithStableErrors(string mode)
    {
        var exception = Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
                root["threshold"] = JsonNode.Parse($"{{\"mode\":{mode}}}"))));

        Assert.Equal("打印任务 JSON 格式无效", exception.Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsUnicodeDigitsInUtcTimestamp()
    {
        var exception = Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
                root["createdAtUtc"] = "２０２６-09-08T00:00:00.12345678901234567890Z")));

        Assert.Equal("创建时间必须是有效的 UTC 日期时间", exception.Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsDuplicatePropertiesAtRootAndNestedLayers()
    {
        var rootException = Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(CreateManifest().Replace(
                "\"jobId\":\"job-1\"", "\"jobId\":\"job-1\",\"jobId\":\"job-2\"", StringComparison.Ordinal)));
        var nestedException = Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(CreateManifest().Replace(
                "\"range\":{\"from\":1,\"to\":1}", "\"range\":{\"from\":1,\"from\":2,\"to\":1}", StringComparison.Ordinal)));

        Assert.Equal("打印任务包含重复字段", rootException.Message);
        Assert.Equal("打印任务包含重复字段", nestedException.Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsMalformedAssetPayloads()
    {
        Assert.Equal("打印资产 PNG 数据不是有效的 Base64", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => Asset(root)["pngBase64"] = "abc "))).Message);
        Assert.Equal("打印资产必须是完整的 PNG 图像", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => Asset(root)["pngBase64"] = "aGVsbG8="))).Message);
        Assert.Equal("打印资产 SHA-256 格式无效", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => Asset(root)["sha256"] = "not-a-hash"))).Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsNullEntriesAndSequenceInvariants()
    {
        Assert.Equal("打印资产不能为空", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["assets"] = new JsonArray((JsonNode?)null)))).Message);
        Assert.Equal("打印序列项不能为空", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["sequence"] = new JsonArray((JsonNode?)null)))).Message);
        Assert.Equal("打印序列序号必须从 1 连续递增", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["sequence"]!.AsArray()[0]!.AsObject()["ordinal"] = 2))).Message);
        Assert.Equal("预期标签数必须与打印序列一致", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["expectedLabels"] = 2))).Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsDuplicateAssetsAndIncorrectReferenceCounts()
    {
        Assert.Equal("打印序列必须完整覆盖每个源页和副本", Assert.Throws<ProtocolValidationException>(() =>
            ProtocolValidator.DeserializeAndValidateManifest(Mutate(root => root["copies"] = 2))).Message);
        Assert.Equal("打印资产标识必须唯一", Assert.Throws<ProtocolValidationException>(() => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
        {
            var assets = root["assets"]!.AsArray(); assets.Add(assets[0]!.DeepClone()); root["range"]!.AsObject()["to"] = 2;
            var entry = root["sequence"]!.AsArray()[0]!.DeepClone().AsObject(); entry["ordinal"] = 2; entry["sourcePageNumber"] = 2; root["sequence"]!.AsArray().Add(entry); root["expectedLabels"] = 2;
        }))).Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_AcceptsRepeatedSourcePagesReferencingOneAsset()
    {
        var manifest = ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
        {
            root["range"]!.AsObject()["to"] = 2;
            root["copies"] = 2;
            root["expectedLabels"] = 4;
            var first = root["sequence"]!.AsArray()[0]!.DeepClone().AsObject();
            root["sequence"] = new JsonArray(
                first.DeepClone(),
                With(first, ("ordinal", 2), ("sourcePageNumber", 2)),
                With(first, ("ordinal", 3), ("copyNumber", 2)),
                With(first, ("ordinal", 4), ("sourcePageNumber", 2), ("copyNumber", 2)));
        }));

        Assert.Single(manifest.Assets!);
        Assert.Equal(4, manifest.Sequence!.Count);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsDuplicateSourceCopyPairs()
    {
        var exception = Assert.Throws<ProtocolValidationException>(() => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
        {
            root["range"]!.AsObject()["to"] = 2;
            root["expectedLabels"] = 2;
            var first = root["sequence"]!.AsArray()[0]!.DeepClone().AsObject();
            root["sequence"] = new JsonArray(first.DeepClone(), With(first, ("ordinal", 2)));
        })));

        Assert.Equal("打印序列必须完整覆盖每个源页和副本", exception.Message);
    }

    [Fact]
    public void DeserializeAndValidateManifest_RejectsSequenceOrderThatDisagreesWithCollate()
    {
        var exception = Assert.Throws<ProtocolValidationException>(() => ProtocolValidator.DeserializeAndValidateManifest(Mutate(root =>
        {
            root["range"]!.AsObject()["to"] = 2;
            root["copies"] = 2;
            root["expectedLabels"] = 4;
            var first = root["sequence"]!.AsArray()[0]!.DeepClone().AsObject();
            root["sequence"] = new JsonArray(
                With(first, ("ordinal", 1), ("sourcePageNumber", 2)),
                With(first, ("ordinal", 2)),
                With(first, ("ordinal", 3), ("sourcePageNumber", 2), ("copyNumber", 2)),
                With(first, ("ordinal", 4), ("copyNumber", 2)));
        })));

        Assert.Equal("打印序列顺序与逐份打印设置不一致", exception.Message);
    }

    private static void AssertRequired(Func<string> create) => Assert.Equal("打印任务缺少必填字段", Assert.Throws<ProtocolValidationException>(() => ProtocolValidator.DeserializeAndValidateManifest(create())).Message);
    private static void AssertUnsupported(Action<JsonObject> mutate) => Assert.Equal("打印任务包含不支持的字段", Assert.Throws<ProtocolValidationException>(() => ProtocolValidator.DeserializeAndValidateManifest(Mutate(mutate))).Message);
    private static JsonObject Asset(JsonObject root) => root["assets"]!.AsArray()[0]!.AsObject();
    private static void RemoveNested(JsonObject root, string layer, string field)
    {
        if (layer is "range" or "threshold") root[layer]!.AsObject().Remove(field);
        else root[layer]!.AsArray()[0]!.AsObject().Remove(field);
    }
    private static string Mutate(Action<JsonObject> mutate) { var root = JsonNode.Parse(CreateManifest())!.AsObject(); mutate(root); return root.ToJsonString(); }
    private static JsonObject With(JsonObject source, params (string Name, int Value)[] changes)
    {
        var copy = source.DeepClone().AsObject();
        foreach (var (name, value) in changes) copy[name] = value;
        return copy;
    }
    private static string CreateManifest() => """{"protocolVersion":1,"jobId":"job-1","createdAtUtc":"2026-09-08T00:00:00.000Z","websiteVersion":"1.0.0","printerId":"printer-1","printerName":"XP-420B","profileId":"xp420b-100x75-203dpi","printerProfileVersion":"1.0.0","widthMm":100,"heightMm":75,"widthDots":800,"heightDots":600,"layout":"landscape","range":{"from":1,"to":1},"copies":1,"collate":true,"horizontalOffsetMm":0,"verticalOffsetMm":0,"threshold":{"mode":"auto"},"expectedLabels":1,"assets":[{"assetId":"asset-1","labelId":"LABEL-1","widthDots":800,"heightDots":600,"rotation":0,"pngBase64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHSj8AAAAASUVORK5CYII=","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"sequence":[{"ordinal":1,"assetId":"asset-1","labelId":"LABEL-1","sourcePageNumber":1,"copyNumber":1}]}""";
}
